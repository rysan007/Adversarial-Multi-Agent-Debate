import React, { useState, useMemo } from 'react';
import { Upload, ChevronRight, FileText, Settings, Shield, AlertCircle, CheckCircle2, BarChart3, LayoutDashboard, Target, Layers } from 'lucide-react';

export default function BaselineViewer() {
  const [rawData, setRawData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('viewer');

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => processJSON(e.target.result);
      reader.readAsText(file);
    }
  };

  const processJSON = (text) => {
    try {
      const parsed = JSON.parse(text);
      let flattened = [];
      if (Array.isArray(parsed)) {
        parsed.forEach(item => {
          if (Array.isArray(item)) {
            flattened.push(...item);
          } else {
            flattened.push(item);
          }
        });
      } else if (parsed.question) {
         flattened = [parsed]; 
      } else {
         throw new Error("Unrecognized JSON structure. Expected an array of logs.");
      }
      
      setLogs(flattened);
      setRawData(text);
      setSelectedIndex(0);
      setError('');
    } catch (err) {
      setError('Invalid JSON format: ' + err.message);
    }
  };

  const getResponseContent = (log) => {
    if (!log) return "";
    
    // Self-Consistent Arrays
    if (Array.isArray(log.responses)) return log.responses.map((r, i) => `--- Sample ${i+1} ---\n${r}`).join('\n\n');
    if (Array.isArray(log.model_responses)) return log.model_responses.map((r, i) => `--- Sample ${i+1} ---\n${r}`).join('\n\n');
    
    // Direct Outputs
    if (log.response) return log.response;
    if (log.output) return log.output;
    if (log.model_response) return log.model_response;
    
    // Transcripts (Debate or CoT)
    if (log.transcript && Array.isArray(log.transcript)) {
      return log.transcript.map((t, i) => {
        let text = `--- Round ${t.round !== undefined ? t.round : i} ---\n`;
        if (t.agent_a) text += `Agent A:\n${t.agent_a}\n\n`;
        if (t.agent_b) text += `Agent B:\n${t.agent_b}\n\n`;
        if (t.content) text += `${t.content}\n\n`;
        if (!t.agent_a && !t.agent_b && !t.content) text += JSON.stringify(t);
        return text;
      }).join('\n');
    }
    return JSON.stringify(log, null, 2); 
  };

  const stats = useMemo(() => {
    if (!logs.length) return null;

    let globalStats = { total: logs.length, globalMatches: 0 };
    let modes = {};

    logs.forEach(log => {
      // 1. Detect Evaluation Strategy
      let modeName = 'One-Shot Baseline';
      if (log.transcript && log.transcript.some(t => t.agent_a && t.agent_b)) {
          modeName = 'Multi-Agent Debate';
      } else if (
          String(log.method).toLowerCase().includes('self') || 
          String(log.config_used?.method).toLowerCase().includes('self') || 
          (Array.isArray(log.responses) && log.responses.length > 1) ||
          (Array.isArray(log.model_responses) && log.model_responses.length > 1) ||
          log.n_samples > 1 || log.config_used?.n_samples > 1
      ) {
          modeName = 'Self-Consistent Baseline';
      }

      if (!modes[modeName]) {
          modes[modeName] = { 
            count: 0, correct: 0, words: 0, 
            actualTrue: 0, actualTrueCorrect: 0, 
            actualFalse: 0, actualFalseCorrect: 0, 
            predTrue: 0, predFalse: 0, 
            evals: 0, conf: 0, unanimous: 0 
          };
      }
      let m = modes[modeName];
      m.count++;

      // 2. Extract Data
      const gt = String(log.ground_truth).toLowerCase();
      const consensus = log.final_consensus ? String(log.final_consensus).toLowerCase() : '';
      const isGtTrue = ['true', 'yes', '1'].includes(gt);
      const isGtFalse = ['false', 'no', '0'].includes(gt);

      if (isGtTrue) m.actualTrue++;
      if (isGtFalse) m.actualFalse++;

      // Stance / Verdict Matching
      let isCorrect = false;
      let modelStance = null;
      
      let evalSource = log.evaluations?.[0] || log.jury_evaluations?.[0] || log;
      if (typeof evalSource === 'string') {
        try { evalSource = JSON.parse(evalSource); } catch(e) {}
      }
      const verdictStr = String(evalSource.verdict || consensus || "").toLowerCase();
      
      if (/\b(true|yes)\b/.test(verdictStr)) modelStance = true;
      else if (/\b(false|no)\b/.test(verdictStr)) modelStance = false;

      // Fallback text check
      if (modelStance === null && modeName !== 'Multi-Agent Debate') {
          const rawText = String(getResponseContent(log)).toLowerCase();
          if (/\b(yes|true)\b/.test(rawText)) modelStance = true;
          else if (/\b(no|false)\b/.test(rawText)) modelStance = false;
      }

      if (modelStance === true) m.predTrue++;
      if (modelStance === false) m.predFalse++;

      if (modelStance !== null) {
        if ((modelStance && isGtTrue) || (!modelStance && isGtFalse)) isCorrect = true;
      } else if (modeName === 'Multi-Agent Debate') {
        let winner = consensus.includes('agent a') ? 'a' : consensus.includes('agent b') ? 'b' : null;
        if (winner && log.transcript) {
          const lastMsg = [...log.transcript].reverse().find(t => t[`agent_${winner}`]);
          if (lastMsg && (/\b(yes|true)\b/.test(String(lastMsg[`agent_${winner}`]).toLowerCase()) && isGtTrue || /\b(no|false)\b/.test(String(lastMsg[`agent_${winner}`]).toLowerCase()) && isGtFalse)) {
             isCorrect = true;
          }
        }
      } else if (consensus.includes(gt) || verdictStr.includes(gt)) {
        isCorrect = true;
      }

      if (isCorrect) {
          globalStats.globalMatches++;
          m.correct++;
          if (isGtTrue) m.actualTrueCorrect++;
          if (isGtFalse) m.actualFalseCorrect++;
      }

      // Unanimity
      if (log.vote_breakdown) {
        const votes = Object.values(log.vote_breakdown);
        if (Math.max(...votes) === votes.reduce((a,b)=>a+b, 0) && votes.length > 0) m.unanimous++;
      } else if (log.evaluations && Array.isArray(log.evaluations) && log.evaluations.length > 1) {
          const v0 = log.evaluations[0]?.verdict;
          if (v0 && log.evaluations.every(e => e.verdict === v0)) m.unanimous++;
      }

      // Confidence
      let evalBlock = log.evaluations || log.jury_evaluations || log.jury_results || log;
      const evalStr = typeof evalBlock === 'string' ? evalBlock : JSON.stringify(evalBlock);
      const confMatches = [...evalStr.matchAll(/["']?confidence(?:_score)?["']?\s*:\s*["']?([0-9.]+)["']?/gi)];
      if (confMatches && confMatches.length > 0) {
        confMatches.forEach(match => {
          const num = parseFloat(match[1]);
          if (!isNaN(num) && typeof num === 'number') {
            m.conf += num;
            m.evals++;
          }
        });
      }

      // Words
      const outputText = getResponseContent(log);
      m.words += outputText ? outputText.split(/\s+/).length : 0;
    });

    return { globalStats, modes };
  }, [logs]);

  const selectedLog = selectedIndex !== null ? logs[selectedIndex] : null;

  const getEvaluationsForRender = (log) => {
    let rawEvals = log.evaluations || log.jury_evaluations || log.jury_results;
    if (!rawEvals) return [];
    let evalArray = Array.isArray(rawEvals) ? rawEvals : typeof rawEvals === 'object' ? Object.values(rawEvals) : [rawEvals];
    return evalArray.map(rawEv => {
      if (typeof rawEv === 'string') {
        try { return JSON.parse(rawEv); } catch(e) { return { analysis: rawEv }; }
      }
      return rawEv;
    });
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 font-sans">
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center shadow-sm z-20">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg text-white"><LayoutDashboard size={20} /></div>
          <h1 className="font-bold text-xl text-slate-800">Universal Evaluation Suite</h1>
        </div>
        {logs.length > 0 && (
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button onClick={() => setActiveTab('viewer')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'viewer' ? 'bg-white text-indigo-700 shadow-sm border border-slate-200' : 'text-slate-600 hover:text-slate-900'}`}><FileText size={16} /> Data Viewer</button>
            <button onClick={() => setActiveTab('analytics')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'analytics' ? 'bg-white text-indigo-700 shadow-sm border border-slate-200' : 'text-slate-600 hover:text-slate-900'}`}><BarChart3 size={16} /> Analytics</button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden flex">
        {logs.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-50">
            <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-6 shadow-sm"><Upload size={40} /></div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Upload Evaluation Logs</h2>
            <p className="text-slate-500 mb-6 text-center max-w-sm">Upload One-Shot, Self-Consistent, or Debate logs. The suite will automatically detect and categorize them.</p>
            <label className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg cursor-pointer transition-colors font-medium shadow-md flex items-center gap-2">
              <Upload size={18} /> Browse Files
              <input type="file" accept=".json" className="hidden" onChange={handleFileUpload} />
            </label>
            {error && <p className="text-red-500 text-sm mt-4 flex items-center gap-1 bg-red-50 px-3 py-2 rounded-md border border-red-200"><AlertCircle size={16}/> {error}</p>}
          </div>
        ) : activeTab === 'analytics' ? (
          <div className="flex-1 overflow-y-auto p-8 bg-slate-100">
            <div className="max-w-6xl mx-auto space-y-6">
              
              {/* Strategy Comparison Cards */}
              <div className="flex items-center gap-2 mb-2">
                 <Layers className="text-indigo-500" size={24} />
                 <h2 className="text-xl font-bold text-slate-800">Strategy Comparison Analysis</h2>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {stats && Object.entries(stats.modes).map(([modeName, m]) => (
                  <div key={modeName} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                    <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex justify-between items-center">
                       <h3 className="font-bold text-slate-800">{modeName}</h3>
                       <span className="text-xs font-semibold bg-slate-200 text-slate-600 px-2 py-1 rounded-full">n={m.count}</span>
                    </div>
                    
                    <div className="p-5 flex-1 flex flex-col gap-6">
                       {/* Main KPI */}
                       <div className="flex justify-between items-end">
                         <div>
                           <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">Accuracy</p>
                           <p className={`text-4xl font-bold mt-1 ${m.correct/m.count >= 0.6 ? 'text-emerald-600' : 'text-slate-800'}`}>
                              {Math.round((m.correct / m.count) * 100)}%
                           </p>
                         </div>
                         <div className="text-right">
                           <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">Avg Words</p>
                           <p className="text-2xl font-bold text-slate-700 mt-1">{Math.round(m.words / m.count)}</p>
                         </div>
                       </div>

                       <div className="h-px bg-slate-100 w-full" />

                       {/* Ground Truth Breakdown */}
                       <div>
                         <p className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1 mb-3"><Target size={14}/> Acc by Ground Truth</p>
                         <div className="space-y-3">
                           <div>
                             <div className="flex justify-between text-xs mb-1">
                               <span className="text-slate-600 font-medium">True ({m.actualTrue})</span>
                               <span className="font-bold">{m.actualTrue > 0 ? Math.round((m.actualTrueCorrect / m.actualTrue) * 100) : 0}%</span>
                             </div>
                             <div className="w-full bg-slate-100 rounded-full h-2">
                               <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${m.actualTrue > 0 ? (m.actualTrueCorrect / m.actualTrue) * 100 : 0}%` }}></div>
                             </div>
                           </div>
                           <div>
                             <div className="flex justify-between text-xs mb-1">
                               <span className="text-slate-600 font-medium">False ({m.actualFalse})</span>
                               <span className="font-bold">{m.actualFalse > 0 ? Math.round((m.actualFalseCorrect / m.actualFalse) * 100) : 0}%</span>
                             </div>
                             <div className="w-full bg-slate-100 rounded-full h-2">
                               <div className="bg-amber-500 h-2 rounded-full" style={{ width: `${m.actualFalse > 0 ? (m.actualFalseCorrect / m.actualFalse) * 100 : 0}%` }}></div>
                             </div>
                           </div>
                         </div>
                       </div>

                       {/* Jury Stats */}
                       <div className="mt-auto grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Jury Unanimity</p>
                            <p className="text-sm font-bold text-slate-700 mt-0.5">{Math.round((m.unanimous / m.count) * 100)}%</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Avg Confidence</p>
                            <p className="text-sm font-bold text-slate-700 mt-0.5">{m.evals > 0 ? (m.conf / m.evals).toFixed(1) : 'N/A'}</p>
                          </div>
                       </div>
                    </div>
                  </div>
                ))}
              </div>

            </div>
          </div>
        ) : (
          <>
            <div className="w-1/3 max-w-sm bg-white border-r border-slate-200 flex flex-col h-full overflow-hidden">
              <div className="overflow-y-auto flex-1 p-2 space-y-1">
                {logs.map((log, idx) => (
                  <button key={idx} onClick={() => setSelectedIndex(idx)} className={`w-full text-left p-3 rounded-lg flex items-start gap-3 transition-colors ${selectedIndex === idx ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-slate-50 border border-transparent'}`}>
                    <div className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${log.ground_truth === 'True' ? 'bg-green-500' : 'bg-red-500'}`} />
                    <div className="flex-1 min-w-0"><p className="font-medium text-sm truncate">{log.question}</p></div>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
              {selectedLog ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                    <h2 className="text-xl font-bold mb-4">{selectedLog.question}</h2>
                    <div className="flex gap-4 text-xs font-mono">
                      <span className="bg-slate-100 px-2 py-1 rounded">GT: {selectedLog.ground_truth}</span>
                      <span className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded">Consensus: {selectedLog.final_consensus || 'N/A'}</span>
                    </div>
                  </div>
                  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm font-mono text-sm whitespace-pre-wrap leading-relaxed">
                    {getResponseContent(selectedLog)}
                  </div>
                  {getEvaluationsForRender(selectedLog).length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {getEvaluationsForRender(selectedLog).map((ev, i) => (
                        <div key={i} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-bold text-slate-400">Jury {i+1}</span>
                            {(ev.confidence_score !== undefined || ev.confidence !== undefined) && (
                              <span className="text-xs font-bold text-indigo-500">Conf: {ev.confidence_score || ev.confidence}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 italic mb-2 line-clamp-3">{ev.analysis || ev.reasoning}</p>
                          <div className="bg-slate-50 p-2 rounded text-xs font-bold">{ev.verdict || ev.final_consensus || 'N/A'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : <div className="h-full flex items-center justify-center text-slate-400">Select a log to view details</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}