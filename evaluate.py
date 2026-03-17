import json
import re

# This script fulfills Requirement 6 & the Extra Credit Comparison
def extract_conclusion(text):
    if not text: return "unknown"
    match = re.search(r'CONCLUSION:\s*(.*)', text, re.IGNORECASE)
    return match.group(1).strip().lower() if match else "unknown"

def evaluate_debate(log_file="batch_debate_log.json"):
    with open(log_file, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    consensus_correct = 0
    single_judge_correct = 0
    total = len(data)
    
    for item in data:
        gt = str(item.get("ground_truth", "")).lower()
        round_0 = item.get('transcript', [{}])[0]
        
        # ---------------------------------------------------------
        # 1. Evaluate Jury Panel Consensus (Majority Vote)
        # ---------------------------------------------------------
        winner_consensus = item.get("final_consensus", "")
        
        if winner_consensus == "Agent A":
            ans_consensus = extract_conclusion(round_0.get('agent_a', ''))
        elif winner_consensus == "Agent B":
            ans_consensus = extract_conclusion(round_0.get('agent_b', ''))
        else:
            ans_consensus = "unknown"
            
        # Flexible matching for consensus
        if (gt in ans_consensus) or (ans_consensus in gt) or (gt == "true" and "yes" in ans_consensus) or (gt == "false" and "no" in ans_consensus):
            consensus_correct += 1

        # ---------------------------------------------------------
        # 2. Evaluate Single Judge (Judge 1) for Extra Credit Comparison
        # ---------------------------------------------------------
        jury_verdicts = item.get("jury_verdicts", [])
        if jury_verdicts:
            # Extract who Judge 1 thought won
            judge1_verdict_str = jury_verdicts[0].get("verdict", "")
            judge1_match = re.match(r'(Agent\s*[AB])', str(judge1_verdict_str), re.IGNORECASE)
            winner_single = judge1_match.group(1).title() if judge1_match else "Unknown"

            if winner_single == "Agent A":
                ans_single = extract_conclusion(round_0.get('agent_a', ''))
            elif winner_single == "Agent B":
                ans_single = extract_conclusion(round_0.get('agent_b', ''))
            else:
                ans_single = "unknown"

            # Flexible matching for single judge
            if (gt in ans_single) or (ans_single in gt) or (gt == "true" and "yes" in ans_single) or (gt == "false" and "no" in ans_single):
                single_judge_correct += 1
            
    # Print the final report for the GitHub Blog
    print("="*50)
    print("📊 DEBATE PIPELINE ACCURACY RESULTS")
    print("="*50)
    print(f"Total Questions Evaluated: {total}")
    print(f"Single Judge Accuracy:     {(single_judge_correct/total)*100:.2f}% ({single_judge_correct}/{total})")
    print(f"Jury Panel Accuracy:       {(consensus_correct/total)*100:.2f}% ({consensus_correct}/{total})")
    print("="*50)

if __name__ == "__main__":
    try:
        evaluate_debate("batch_debate_log.json")
    except FileNotFoundError:
        print("Could not find batch_debate_log.json. Make sure you run the batch debate first!")