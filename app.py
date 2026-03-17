import streamlit as st
import json
import re
import os
import concurrent.futures
from collections import Counter
from agents import BaseAgent
from orchestrator import DebateOrchestrator
from prompts import PROMPT_A_PHASE_1, PROMPT_B_PHASE_1, PROMPT_A_PHASE_2, PROMPT_B_PHASE_2, PROMPT_JUDGE

# --- 0. Configuration Management ---
CONFIG_FILE = "config.json"
DEFAULT_CONFIG = {
    "api_base": "https://openrouter.ai/api/v1",
    "api_key": "",
    "model_name": "qwen/qwen3.5-9b",
    "temperature": 0.7,
    "max_rounds": 3,
    "max_tokens": 0,
    "jury_size": 3  
}

if not os.path.exists(CONFIG_FILE):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(DEFAULT_CONFIG, f, indent=4)

with open(CONFIG_FILE, "r", encoding="utf-8") as f:
    CONFIG = json.load(f)

# --- Helpers ---
def escape_tags(text):
    if not text: return "Error: No response generated."
    return text.replace("<", "&lt;").replace(">", "&gt;")

def extract_argument(text):
    if not text: return ""
    match = re.search(r'<argument>(.*?)</argument>', text, re.DOTALL | re.IGNORECASE)
    return match.group(1).strip() if match else text.strip()

def extract_conclusion(text):
    if not text: return ""
    match = re.search(r'CONCLUSION:\s*(.*)', text, re.IGNORECASE)
    return match.group(1).strip().lower() if match else "unknown"

def parse_judge_output(text):
    if not text: return {"error": "Empty response"}
    try: return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r'`{3}(?:json)?(.*?)`{3}', text, re.DOTALL)
        if match:
            try: return json.loads(match.group(1).strip())
            except: pass
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            try: return json.loads(match.group(0))
            except: pass
        return {"raw_error_output": text}

def get_winner_from_verdict(verdict_str):
    if not verdict_str: return "Unknown"
    match = re.match(r'(Agent\s*[AB])', str(verdict_str), re.IGNORECASE)
    return match.group(1).title() if match else "Unknown"

def render_agent_message(text, agent_name):
    if not text:
        st.error(f"{agent_name} returned an empty response.")
        return
        
    st.markdown(f"**{agent_name}**")
    
    thinking_match = re.search(r'<thinking>(.*?)</thinking>', text, re.DOTALL | re.IGNORECASE)
    if thinking_match:
        with st.expander("💭 Internal Thought Process (CoT)"):
            st.markdown(f"*{thinking_match.group(1).strip()}*")
            
    argument_match = re.search(r'<argument>(.*?)</argument>', text, re.DOTALL | re.IGNORECASE)
    if argument_match:
        arg_text = argument_match.group(1).strip()
        arg_text = re.sub(r'(CONCLUSION:\s*.*)', r'\n\n---\n🎯 **\1**', arg_text, flags=re.IGNORECASE)
        st.markdown(arg_text)
    else:
        clean_text = text
        if thinking_match:
            clean_text = clean_text.replace(thinking_match.group(0), "").strip()
        clean_text = re.sub(r'(CONCLUSION:\s*.*)', r'\n\n---\n🎯 **\1**', clean_text, flags=re.IGNORECASE)
        st.markdown(escape_tags(clean_text))

def append_to_log(filename, new_record):
    data = []
    if os.path.exists(filename):
        try:
            with open(filename, "r", encoding="utf-8") as f:
                data = json.load(f)
                if not isinstance(data, list):
                    data = [data]
        except (json.JSONDecodeError, IOError):
            data = [] 
            
    data.append(new_record)
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)

def run_headless_debate(question, ground_truth, config_params):
    agent_a = BaseAgent("Debater A", PROMPT_A_PHASE_1, model_name=config_params["model_name"], api_base=config_params["api_base"], api_key=config_params.get("api_key"))
    agent_b = BaseAgent("Debater B", PROMPT_B_PHASE_1, model_name=config_params["model_name"], api_base=config_params["api_base"], api_key=config_params.get("api_key"))
    orchestrator = DebateOrchestrator(agent_a, agent_b, question, ground_truth, max_rounds=config_params["max_rounds"])
    
    # Phase 1
    agent_a.add_context("user", f"Question: {question}\n\nPhase 1: Present your independent argument.")
    pos_a = agent_a.generate_response(temperature=config_params["temperature"], max_tokens=config_params["max_tokens"])
    
    agent_b.add_context("user", f"Question: {question}\n\nPhase 1: Present your independent argument.")
    pos_b = agent_b.generate_response(temperature=config_params["temperature"], max_tokens=config_params["max_tokens"])
    
    orchestrator.transcript.append({"round": 0, "agent_a": pos_a, "agent_b": pos_b})
    
    ans_a, ans_b = extract_conclusion(pos_a), extract_conclusion(pos_b)
    skip_debate = (ans_a and ans_b and ans_a == ans_b and ans_a != "unknown")

    # Phase 2
    if not skip_debate:
        agent_a.system_prompt = PROMPT_A_PHASE_2
        agent_b.system_prompt = PROMPT_B_PHASE_2
        
        convergence_count = 0
        for r in range(1, config_params["max_rounds"] + 1):
            public_transcript = "\n".join([f"Round {t['round']} | A: {extract_argument(t['agent_a'])} | B: {extract_argument(t['agent_b'])}" for t in orchestrator.transcript])
            
            # Re-inject the question explicitly to anchor the debate
            agent_a.add_context("user", f"Question: {question}\n\nPublic Debate Transcript:\n{public_transcript}\n\nRebut Debater B. Be concise.")
            arg_a = agent_a.generate_response(temperature=config_params["temperature"], max_tokens=config_params["max_tokens"])
            
            temp_transcript = public_transcript + f"\nRound {r} | A: {extract_argument(arg_a)}"
            agent_b.add_context("user", f"Question: {question}\n\nPublic Debate Transcript:\n{temp_transcript}\n\nCounter Debater A. Be concise.")
            arg_b = agent_b.generate_response(temperature=config_params["temperature"], max_tokens=config_params["max_tokens"])
            
            orchestrator.transcript.append({"round": r, "agent_a": arg_a, "agent_b": arg_b})
            
            if extract_conclusion(arg_a) == extract_conclusion(arg_b) and extract_conclusion(arg_a) != "unknown":
                convergence_count += 1
                if convergence_count >= 2: break
            else:
                convergence_count = 0 

    # Phase 3
    full_transcript_str = "\n".join([f"Round {t['round']}\nAgent A:\n{t['agent_a']}\nAgent B:\n{t['agent_b']}\n" for t in orchestrator.transcript])
    parsed_verdicts, winners = [], []
    
    for i in range(int(config_params["jury_size"])):
        judge = BaseAgent(f"Judge {i+1}", PROMPT_JUDGE, model_name=config_params["model_name"], api_base=config_params["api_base"], api_key=config_params.get("api_key"))
        judge.add_context("user", f"Question: {question}\n\nFull Debate Transcript:\n{full_transcript_str}\n\nProvide your JSON verdict.")
        v_text = judge.generate_response(temperature=config_params["temperature"], max_tokens=config_params["max_tokens"])
        parsed_v = parse_judge_output(v_text)
        parsed_verdicts.append(parsed_v)
        winners.append(get_winner_from_verdict(parsed_v.get("verdict", "")))

    vote_counts = Counter(winners)
    majority_winner = vote_counts.most_common(1)[0][0] if winners else "Unknown"
        
    return {
        "question": question, "ground_truth": ground_truth, "config_used": config_params,
        "transcript": orchestrator.transcript, "jury_verdicts": parsed_verdicts,
        "final_consensus": majority_winner, "vote_breakdown": dict(vote_counts)
    }

# --- 2. Streamlit UI Setup ---
st.set_page_config(page_title="LLM Debate Pipeline", layout="wide")
st.title("⚖️ Adversarial Multi-Agent Debate")

with st.sidebar:
    st.header("Pipeline Configuration")
    api_base = st.text_input("API Base URL", value=CONFIG.get("api_base", "https://openrouter.ai/api/v1"))
    
    # Retrieve from config first, fallback to environment variable, then to empty
    default_api_key = CONFIG.get("api_key", os.environ.get("OPENAI_API_KEY", ""))
    api_key = st.text_input("API Key", type="password", value=default_api_key)
    
    model_name = st.text_input("Model Name", value=CONFIG.get("model_name", "qwen/qwen3.5-9b"))
    max_rounds = st.slider("Max Debate Rounds (N)", min_value=3, max_value=7, value=CONFIG.get("max_rounds", 3))
    temperature = st.slider("Temperature", min_value=0.0, max_value=1.0, value=CONFIG.get("temperature", 0.7), step=0.1)
    jury_size = st.number_input("Jury Size (Judges)", min_value=1, max_value=5, value=CONFIG.get("jury_size", 3))
    max_tokens_input = st.number_input("Max Tokens (0 for unlimited)", min_value=0, max_value=32000, value=CONFIG.get("max_tokens", 0))

max_tokens = max_tokens_input if max_tokens_input > 0 else None

current_config = {
    "api_base": api_base, "api_key": api_key, "model_name": model_name, "max_rounds": max_rounds,
    "temperature": temperature, "jury_size": jury_size, "max_tokens": max_tokens
}

# --- 3. UI TABS ---
tab1, tab2 = st.tabs(["💬 Single Debate UI", "⚡ Batch Processing (Experiments)"])

with tab1:
    st.markdown("### Enter a Reasoning or Fact Verification Question")
    question = st.text_area("Question:", "Did the Roman Empire exist at the same time as the Mayan civilization?")
    ground_truth = st.text_input("Ground Truth (for evaluation logging):", "Yes")

    if st.button("Start Debate Pipeline", type="primary"):
        agent_a = BaseAgent("Debater A", PROMPT_A_PHASE_1, model_name=model_name, api_base=api_base, api_key=api_key)
        agent_b = BaseAgent("Debater B", PROMPT_B_PHASE_1, model_name=model_name, api_base=api_base, api_key=api_key)
        orchestrator = DebateOrchestrator(agent_a, agent_b, question, ground_truth, max_rounds=max_rounds)
        
        # --- PHASE 1 ---
        st.markdown("---")
        st.subheader("Phase 1: Initial Positions")
        with st.spinner("Debater A thinking..."):
            agent_a.add_context("user", f"Question: {question}\n\nPhase 1: Present your independent argument.")
            pos_a = agent_a.generate_response(temperature=temperature, max_tokens=max_tokens)
            with st.chat_message("user", avatar="🔵"): render_agent_message(pos_a, "Debater A")
                
        with st.spinner("Debater B thinking..."):
            agent_b.add_context("user", f"Question: {question}\n\nPhase 1: Present your independent argument.")
            pos_b = agent_b.generate_response(temperature=temperature, max_tokens=max_tokens)
            with st.chat_message("user", avatar="🔴"): render_agent_message(pos_b, "Debater B")
                
        orchestrator.transcript.append({"round": 0, "agent_a": pos_a, "agent_b": pos_b})
        ans_a, ans_b = extract_conclusion(pos_a), extract_conclusion(pos_b)
        skip_debate = (ans_a and ans_b and ans_a == ans_b and ans_a != "unknown")
        
        if skip_debate:
            st.success(f"🤝 Consensus reached: '{ans_a}'. Skipping Phase 2.")

        # --- PHASE 2 ---
        if not skip_debate:
            st.markdown("---")
            st.subheader("Phase 2: Multi-Round Debate")
            
            agent_a.system_prompt = PROMPT_A_PHASE_2
            agent_b.system_prompt = PROMPT_B_PHASE_2
            
            convergence_count = 0
            for r in range(1, max_rounds + 1):
                st.markdown(f"**Round {r}**")
                public_transcript = "\n".join([f"Round {t['round']} | A: {extract_argument(t['agent_a'])} | B: {extract_argument(t['agent_b'])}" for t in orchestrator.transcript])
                
                # Re-inject the question to anchor the UI debate
                with st.spinner(f"Round {r}: A rebutting..."):
                    agent_a.add_context("user", f"Question: {question}\n\nTranscript:\n{public_transcript}\n\nRebut B.")
                    arg_a = agent_a.generate_response(temperature=temperature, max_tokens=max_tokens)
                    with st.chat_message("user", avatar="🔵"): render_agent_message(arg_a, "Debater A")
                        
                with st.spinner(f"Round {r}: B responding..."):
                    temp_transcript = public_transcript + f"\nRound {r} | A: {extract_argument(arg_a)}"
                    agent_b.add_context("user", f"Question: {question}\n\nTranscript:\n{temp_transcript}\n\nCounter A.")
                    arg_b = agent_b.generate_response(temperature=temperature, max_tokens=max_tokens)
                    with st.chat_message("user", avatar="🔴"): render_agent_message(arg_b, "Debater B")
                        
                orchestrator.transcript.append({"round": r, "agent_a": arg_a, "agent_b": arg_b})
                cur_ans_a, cur_ans_b = extract_conclusion(arg_a), extract_conclusion(arg_b)
                
                if cur_ans_a == cur_ans_b and cur_ans_a != "unknown":
                    convergence_count += 1
                    if convergence_count >= 2:
                        st.success("🏁 Agents converged.")
                        break
                else:
                    convergence_count = 0 

        # --- PHASE 3 ---
        st.markdown("---")
        st.subheader(f"Phase 3: Final Judgment (Panel of {int(jury_size)})")
        full_transcript_str = "\n".join([f"Round {t['round']}\nAgent A:\n{t['agent_a']}\nAgent B:\n{t['agent_b']}\n" for t in orchestrator.transcript])
        
        parsed_verdicts, winners = [], []
        for i in range(int(jury_size)):
            judge_name = f"Judge {i+1}"
            with st.spinner(f"{judge_name} reviewing..."):
                current_judge = BaseAgent(judge_name, PROMPT_JUDGE, model_name=model_name, api_base=api_base, api_key=api_key)
                current_judge.add_context("user", f"Question: {question}\n\nTranscript:\n{full_transcript_str}")
                v_text = current_judge.generate_response(temperature=temperature, max_tokens=max_tokens)
                parsed_v = parse_judge_output(v_text)
                parsed_verdicts.append(parsed_v)
                winners.append(get_winner_from_verdict(parsed_v.get("verdict", "")))
                
                with st.expander(f"⚖️ {judge_name} Verdict: {winners[-1]}"):
                    if "verdict" in parsed_v: st.markdown(f"**Decision:** {parsed_v['verdict']}")
                    st.json(parsed_v)

        vote_counts = Counter(winners)
        majority_winner = vote_counts.most_common(1)[0][0]
        st.header(f"🏆 Panel Consensus: {majority_winner} Wins!")
            
        # --- PHASE 4 ---
        append_to_log("debate_log.json", {
            "question": question, "ground_truth": ground_truth, "config_used": current_config,
            "transcript": orchestrator.transcript, "jury_verdicts": parsed_verdicts,
            "final_consensus": majority_winner
        })
        st.info("Results appended to `debate_log.json`.")

with tab2:
    st.markdown("### Batch Processing (Experiments)")
    st.markdown("Upload a dataset file (`.json` or `.jsonl`). Auto-parses StrategyQA, SciFact, or ARC.")
    
    col1, col2 = st.columns(2)
    with col1:
        max_batch_items = st.number_input("Max Questions to Run", min_value=1, value=100)
    with col2:
        max_workers = st.number_input("Parallel Workers (Speed!)", min_value=1, max_value=10, value=5)
        
    uploaded_file = st.file_uploader("Upload Dataset", type=["json", "jsonl"])
    
    if uploaded_file is not None:
        try:
            if uploaded_file.name.endswith('.jsonl'):
                string_data = uploaded_file.getvalue().decode("utf-8")
                raw_dataset = [json.loads(line) for line in string_data.strip().split('\n') if line.strip()]
            else:
                raw_dataset = json.load(uploaded_file)
                
            dataset = []
            for item in raw_dataset:
                q = item.get("question", "")
                if isinstance(q, dict) and "stem" in q:
                    q = f"{q['stem']} Options: " + " ".join([f"({c['label']}) {c['text']}" for c in q.get("choices", [])])
                elif "claim" in item:
                    q = item["claim"]
                
                gt = item.get("ground_truth", item.get("answer", item.get("answerKey", item.get("label", "Unknown"))))
                if q: dataset.append({"question": str(q), "ground_truth": str(gt)})

            # SMART RESUME LOGIC: Check existing logs so we don't repeat work!
            processed_questions = set()
            batch_filename = "batch_debate_log.json"
            if os.path.exists(batch_filename):
                try:
                    with open(batch_filename, "r", encoding="utf-8") as f:
                        existing_data = json.load(f)
                        processed_questions = {item.get("question") for item in existing_data if "question" in item}
                except: pass
            
            # Filter out questions we've already finished
            remaining_dataset = [item for item in dataset if item["question"] not in processed_questions]
            
            if max_batch_items < len(remaining_dataset):
                remaining_dataset = remaining_dataset[:max_batch_items]

            st.success(f"Found {len(processed_questions)} already processed. {len(remaining_dataset)} remaining items queued to run.")
            
            if st.button("Start Parallel Batch Run", type="primary"):
                progress_bar = st.progress(0)
                status_text = st.empty()
                
                # --- PARALLEL PROCESSING MAGIC IN STREAMLIT ---
                completed_count = 0
                
                with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                    # Submit all tasks to background threads
                    future_to_item = {
                        executor.submit(run_headless_debate, item["question"], item["ground_truth"], current_config): item 
                        for item in remaining_dataset
                    }
                    
                    # Process them as they finish
                    for future in concurrent.futures.as_completed(future_to_item):
                        try:
                            result = future.result()
                            # It is safe to append_to_log here because as_completed yields back to the main thread
                            append_to_log(batch_filename, result)
                            
                            completed_count += 1
                            status_text.text(f"Running in Parallel... {completed_count}/{len(remaining_dataset)} complete")
                            progress_bar.progress(completed_count / len(remaining_dataset))
                            
                        except Exception as e:
                            st.error(f"Error processing item: {e}")
                            
                st.balloons()
                st.success(f"Parallel Batch complete! Results appended to {batch_filename}")
                
        except Exception as e:
            st.error(f"Error parsing dataset: {e}")