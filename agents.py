import os
import requests
from openai import OpenAI

class BaseAgent:
    """
    Core LLM communication module. 
    Handles state, history, and robust API fallbacks.
    """
    def __init__(self, role_name, system_prompt, model_name="gpt-4o-mini", api_base=None, api_key=None):
        self.role_name = role_name
        self.system_prompt = system_prompt
        self.model_name = model_name
        self.api_base = api_base or os.environ.get("OPENAI_API_BASE", "https://openrouter.ai/api/v1")
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        
        self.client = OpenAI(
            base_url=self.api_base, 
            api_key=self.api_key,
            timeout=None
        )
        self.messages = []
        self.reset_history()

    def reset_history(self):
        self.messages = [{"role": "system", "content": self.system_prompt}]

    def add_context(self, role, content):
        self.reset_history() # Keep context focused on the current debate round
        self.messages.append({"role": role, "content": content})

    def generate_response(self, temperature=0.7, max_tokens=None):
        reply = ""
        try:
            payload = {
                "model": self.model_name,
                "messages": self.messages,
                "temperature": temperature,
                "stream": True
            }
            if max_tokens: payload["max_tokens"] = max_tokens
                
            response = self.client.chat.completions.create(**payload)
            for chunk in response:
                content = getattr(chunk.choices[0].delta, 'content', None)
                if content: reply += content
        except Exception as stream_error:
            # Fallback to raw HTTP with no timeout
            try:
                url = f"{self.api_base.rstrip('/')}/chat/completions"
                headers = {"Authorization": f"Bearer {self.api_key}"}
                req_payload = {
                    "model": self.model_name, "messages": self.messages, 
                    "temperature": temperature, "stream": False
                }
                if max_tokens: req_payload["max_tokens"] = max_tokens
                
                r = requests.post(url, json=req_payload, headers=headers, timeout=None)
                
                if r.status_code == 200:
                    reply = r.json().get("choices", [{}])[0].get("message", {}).get("content", "")
                else:
                    return f"Error: Local server rejected request. Code: {r.status_code}, Reason: {r.text}"
                    
            except Exception as e:
                return f"Error: {self.role_name} failed. {e}"

        return reply if reply.strip() else f"Error: {self.role_name} returned empty."