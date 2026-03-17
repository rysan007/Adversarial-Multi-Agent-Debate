import json
import os
import concurrent.futures
import threading
import time
from agents import BaseAgent
from prompts import PROMPT_BASELINE

# --- Configuration ---
CONFIG_FILE = "config.json"
if os.path.exists(CONFIG_FILE):
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        CONFIG = json.load(f)
else:
    CONFIG = {}

# Extract configurations 
API_BASE = CONFIG.get("api_base", "http://localhost:1234/v1")
MODEL_NAME = CONFIG.get("model_name", "local-model")
# Get api_key primarily from CONFIG, fallback to env var
API_KEY = CONFIG.get("api_key", os.environ.get("OPENAI_API_KEY", "dummy-key-for-local"))
TEMPERATURE = CONFIG.get("temperature", 0.7)

max_tokens_input = CONFIG.get("max_tokens", 0)
MAX_TOKENS = max_tokens_input if max_tokens_input > 0 else 14000

# Thread-safe lock to prevent file corruption when saving progressively
file_write_lock = threading.Lock()

def call_agent_with_retries(agent, prompt, temperature, max_tokens, max_retries=4):
    """Helper to retry API calls if rate limits hit or returns an empty string."""
    for attempt in range(1, max_retries + 1):
        agent.reset_history()
        agent.add_context("user", prompt)
        
        response = agent.generate_response(temperature=temperature, max_tokens=max_tokens)
        
        if response and not str(response).startswith("Error:"):
            return response
            
        print(f"      [!] API Error or Empty Response. Retry {attempt}/{max_retries} pausing for {5 * attempt}s...")
        time.sleep(5 * attempt)
        
    # Cleanly mark as a loss so it doesn't break evaluation logs
    return "Error: Max retries exceeded. CONCLUSION: unknown"

def process_single_item(item, idx, total_items):
    """Processes a single dataset item completely independently for thread safety."""
    q = item.get("question", "")
    print(f"\n" + "="*50)
    print(f"[Processing] Question {idx+1}/{total_items}: {q[:40]}...")
    print("="*50)
    
    # Initialize the agent using the centralized prompt
    agent = BaseAgent(f"Baseline-{idx}", PROMPT_BASELINE, model_name=MODEL_NAME, api_base=API_BASE, api_key=API_KEY)
    
    # 1. Direct QA Baseline (Zero-Shot)
    print(f"  -> [1/4] Running Direct QA...")
    ans_direct = call_agent_with_retries(
        agent, 
        f"Question: {q}", 
        temperature=TEMPERATURE, 
        max_tokens=MAX_TOKENS
    )
    
    # 2. Self-Consistency Baseline (3 independent runs)
    sc_answers = []
    for i in range(3):
        print(f"  -> [{i+2}/4] Running Self-Consistency {i+1}/3...")
        ans = call_agent_with_retries(
            agent, 
            f"Question: {q}", 
            temperature=TEMPERATURE, 
            max_tokens=MAX_TOKENS
        )
        sc_answers.append(ans)
        
    print(f"\n✅ Question {idx+1}/{total_items} complete!")
    
    return {
        "question": q,
        "ground_truth": item.get('ground_truth', 'Unknown'),
        "direct_qa": ans_direct,
        "self_consistency": sc_answers
    }

def run_baselines(dataset_file, max_items=100, max_concurrent_workers=1):
    with open(dataset_file, "r", encoding="utf-8") as f:
        if dataset_file.endswith('.jsonl'):
            raw_data = [json.loads(line) for line in f if line.strip()]
        else:
            raw_data = json.load(f)
        
    dataset = []
    for item in raw_data:
        q = item.get("question", item.get("claim", ""))
        gt = item.get("ground_truth", item.get("answer", "Unknown"))
        if q: dataset.append({"question": str(q), "ground_truth": str(gt)})
        
    # --- SMART RESUME LOGIC ---
    processed_questions = set()
    results = []
    log_filename = "baseline_log.json"
    
    if os.path.exists(log_filename):
        try:
            with open(log_filename, "r", encoding="utf-8") as f:
                existing_data = json.load(f)
                if isinstance(existing_data, list):
                    results = existing_data
                    processed_questions = {item.get("question") for item in results if "question" in item}
        except Exception as e:
            print(f"Warning: Could not read existing log file: {e}")

    remaining_dataset = [item for item in dataset if item["question"] not in processed_questions]
    remaining_dataset = remaining_dataset[:max_items]

    print(f"Found {len(processed_questions)} already processed. {len(remaining_dataset)} remaining items queued to run.")
    
    if not remaining_dataset:
        print("No items left to process! You are completely done.")
        return

    print(f"Starting execution via {API_BASE}...")
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_concurrent_workers) as executor:
        future_to_item = {
            executor.submit(process_single_item, item, i, len(remaining_dataset)): item 
            for i, item in enumerate(remaining_dataset)
        }
        
        for future in concurrent.futures.as_completed(future_to_item):
            try:
                res = future.result()
                with file_write_lock:
                    results.append(res)
                    with open(log_filename, "w", encoding="utf-8") as f:
                        json.dump(results, f, indent=4)
            except Exception as exc:
                print(f"A question generated an exception: {exc}")
            
    print("\n" + "="*40)
    print(f"Baselines complete! All {len(results)} results saved to {log_filename}")
    print("="*40)

if __name__ == "__main__":
    file_path = input("Enter path to your JSON/JSONL dataset (e.g., dataset.json): ")
    run_baselines(file_path, max_items=150, max_concurrent_workers=1)