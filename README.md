# ⚖️ Adversarial Multi-Agent Debate

This repository contains the code and artifacts for an LLM Debate pipeline with an LLM judge, exploring whether structured adversarial debate improves reasoning over single-agent baselines.

## 🚀 Setup & Installation

**1. Clone the repository:**
```bash
git clone [https://github.com/rysan007/Adversarial-Multi-Agent-Debate.git](https://github.com/rysan007/Adversarial-Multi-Agent-Debate.git)
cd Adversarial-Multi-Agent-Debate
```

**2. Install dependencies:**
```bash
pip install -r requirements.txt
```

**3. Configure API Keys:**
Open `config.json` and ensure your `api_base` and `model_name` are set. You will input your API key directly through the Streamlit UI or configure it in your environment variables.

## 💻 Running the Application

To launch the interactive Debate UI and Batch Processing tool:
```bash
streamlit run app.py
```

## 📊 Reproducing the Experiments

[cite_start]This repository includes scripts to reproduce all baseline and debate experiments[cite: 56].

**1. Run the Multi-Agent Debate:** Launch the Streamlit app and use the "Batch Processing" tab to run the dataset. Results will save to `batch_debate_log.json`.

**2. Run the Baselines (Direct QA & Self-Consistency):** ```bash
python baselines.py
```
This will process the dataset sequentially (with built-in API rate-limit pacing and exponential backoff) and save to `baseline_log.json`.

**3. Evaluate Accuracy:**
```bash
python evaluate.py
```
This script parses the logs and outputs the final accuracy comparisons between the single judge, the jury panel, and the baselines.
