import json
import re

class DebateOrchestrator:
    """
    Handles the multi-phase debate protocol (Phases 1-3).
    Separates the debate flow from the UI and Agent logic.
    """
    def __init__(self, debater_a, debater_b, question, ground_truth, max_rounds=3):
        self.agent_a = debater_a
        self.agent_b = debater_b
        self.question = question
        self.ground_truth = ground_truth
        self.max_rounds = max_rounds
        self.transcript = []

    @staticmethod
    def extract_conclusion(text):
        if not text: return "unknown"
        match = re.search(r'CONCLUSION:\s*(.*)', text, re.IGNORECASE)
        return match.group(1).strip().lower() if match else "unknown"

    @staticmethod
    def parse_judge_output(text):
        try: return json.loads(text)
        except:
            match = re.search(r'\{.*\}', text, re.DOTALL)
            if match:
                try: return json.loads(match.group(0))
                except: pass
            return {"raw_error": text}