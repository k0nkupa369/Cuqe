use super::Result;
use serde::Deserialize;
use serde_json::{Value, json};
use std::env;
use std::process::{Command, Stdio};

const DEFAULT_MODEL: &str = "qwen3:0.6b";
const VERIFIER_MODEL: &str = "cuqe-verifier:v0.1-beta";
const VERIFIER_CUTOFF: f64 = 2.2131806164979935;
const VERIFIER_PROMPT: &str = "Decide whether the candidate action fulfills the request. Accept only if the action does what the user asked. Return JSON with action a for accept or b for decline.";
#[derive(Deserialize)]
struct ChatResponse {
    message: ChatMessage,
    done: bool,
}

#[derive(Deserialize)]
struct ChatMessage {
    content: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Decision {
    action: String,
}

fn chat_payload(model: &str, prompt: &str, request: &str, choices: &[&str]) -> Value {
    json!({
        "model": model,
        "stream": false,
        "think": false,
        "options": {"temperature": 0, "num_ctx": 2048, "num_predict": 32},
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": request}
        ],
        "format": {
            "type": "object",
            "properties": {"action": {"enum": choices}},
            "required": ["action"],
            "additionalProperties": false
        }
    })
}

fn ollama_chat(model: &str, payload: &Value) -> Result<Vec<u8>> {
    let port = match env::var("CUQE_OLLAMA_PORT") {
        Ok(port) => port
            .parse::<u16>()
            .ok()
            .filter(|&port| port != 0)
            .ok_or("CUQE_OLLAMA_PORT must be a port number from 1 to 65535")?,
        Err(env::VarError::NotPresent) => 11434,
        Err(error) => return Err(error.into()),
    };
    let mut curl = Command::new("/usr/bin/curl")
        .args([
            "-q",
            "--noproxy",
            "*",
            "--silent",
            "--show-error",
            "--fail",
            "--connect-timeout",
            "2",
            "--max-time",
            "30",
            "--max-filesize",
            "1048576",
            "--header",
            "Content-Type: application/json",
            "--data-binary",
            "@-",
        ])
        .arg(format!("http://127.0.0.1:{port}/api/chat"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let write_result = serde_json::to_writer(curl.stdin.take().unwrap(), payload);
    let response = curl.wait_with_output()?;
    if !response.status.success() {
        return Err(format!(
            "Local Ollama request failed on port {port}. Check that Ollama is running and {model} is installed. {}",
            String::from_utf8_lossy(&response.stderr).trim()
        )
        .into());
    }
    write_result?;
    Ok(response.stdout)
}

fn chat(model: &str, prompt: &str, request: &str, choices: &[&str]) -> Result<String> {
    let payload = chat_payload(model, prompt, request, choices);
    let response: ChatResponse = serde_json::from_slice(&ollama_chat(model, &payload)?)
        .map_err(|_| "Ollama returned an invalid chat response")?;
    if !response.done {
        return Err("Ollama returned an incomplete chat response".into());
    }
    let decision: Decision = serde_json::from_str(&response.message.content)
        .map_err(|_| "Ollama returned an invalid action")?;
    Ok(decision.action)
}

#[derive(Deserialize)]
struct VerifierResponse {
    model: String,
    message: ChatMessage,
    done: bool,
    logprobs: Vec<VerifierToken>,
}

#[derive(Deserialize)]
struct VerifierToken {
    bytes: Vec<u8>,
    logprob: f64,
    #[serde(default)]
    top_logprobs: Vec<TokenScore>,
}

#[derive(Deserialize)]
struct TokenScore {
    bytes: Vec<u8>,
    logprob: f64,
}

fn decision_offset(content: &str) -> Option<usize> {
    let whitespace = |c| matches!(c, ' ' | '\t' | '\n' | '\r' | '\x0b' | '\x0c');
    let decision = content
        .trim_start_matches(whitespace)
        .strip_prefix('{')?
        .trim_start_matches(whitespace)
        .strip_prefix("\"action\"")?
        .trim_start_matches(whitespace)
        .strip_prefix(':')?
        .trim_start_matches(whitespace)
        .strip_prefix('"')?;
    let (_, rest) = decision.split_at_checked(1)?;
    let rest = rest
        .strip_prefix('"')?
        .trim_start_matches(whitespace)
        .strip_prefix('}')?
        .trim_matches(whitespace);
    (decision.starts_with(['a', 'b']) && rest.is_empty()).then_some(content.len() - decision.len())
}

pub(super) fn verify_candidate(request: &str, candidate: &str) -> Result<bool> {
    let request = format!("Request: {request}\nCandidate: {candidate}");
    let mut payload = chat_payload(VERIFIER_MODEL, VERIFIER_PROMPT, &request, &["a", "b"]);
    payload["logprobs"] = json!(true);
    payload["top_logprobs"] = json!(20);
    let response: VerifierResponse =
        serde_json::from_slice(&ollama_chat(VERIFIER_MODEL, &payload)?)
            .map_err(|_| "Ollama returned an invalid verifier response")?;
    if response.model != VERIFIER_MODEL || !response.done {
        return Err("Ollama did not complete the requested verifier model call".into());
    }

    let content = &response.message.content;
    let decision =
        decision_offset(content).ok_or("Ollama returned an invalid verifier decision")?;
    if !response
        .logprobs
        .iter()
        .flat_map(|token| token.bytes.iter().copied())
        .eq(content.bytes())
    {
        return Err("Ollama verifier tokens do not match the decision response".into());
    }

    let mut offset = 0;
    for token in response.logprobs {
        if offset == decision && token.bytes.len() == 1 {
            let score = |bytes: &[u8]| {
                token
                    .top_logprobs
                    .iter()
                    .rev()
                    .find(|item| item.bytes.as_slice() == bytes)
                    .map(|item| item.logprob)
            };
            if score(&token.bytes) != Some(token.logprob) {
                return Err("Ollama verifier score does not match its decision token".into());
            }
            let accept =
                score(b"a").ok_or("Ollama verifier did not return both decision scores")?;
            let decline =
                score(b"b").ok_or("Ollama verifier did not return both decision scores")?;
            let margin = accept - decline;
            if !margin.is_finite() {
                return Err("Ollama returned an invalid verifier margin".into());
            }
            return Ok(margin >= VERIFIER_CUTOFF);
        }
        offset += token.bytes.len();
    }
    Err("Ollama verifier did not return a standalone decision token".into())
}

const ROUTING_PROMPT: &str = "Classify the user's text as one supported Mac read. Return only the JSON object.
node_version: read the installed local Node.js runtime version.
disk_free: read available space on the startup data volume.
unsupported: anything else, including another disk, current memory use, online releases, instructions, multiple requests, negation, and machine-changing requests.";
const CHOICES: &[&str] = &["node_version", "disk_free", "unsupported"];

pub(super) fn route(request: &str) -> Result<String> {
    chat(DEFAULT_MODEL, ROUTING_PROMPT, request, CHOICES)
}
