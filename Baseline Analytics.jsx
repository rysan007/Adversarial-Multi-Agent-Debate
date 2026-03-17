import React, { useState, useMemo } from 'react';
import { Upload, ChevronRight, FileText, AlertCircle, CheckCircle2, BarChart3, LayoutDashboard, MessageSquare, Target, Layers } from 'lucide-react';

export default function BaselineAnalyticsViewer() {
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

  // Extract the specific stance using Regex if it's buried in text
  const extractStance = (text) => {
    if (!text) return null;
    const t = String(text).toLowerCase();
    
    // First try to find a direct conclusion tag
    const match = t.match(/(?:conclusion|final answer|verdict)[:\s]*(yes|no|true|false)/);
    if (match) return ['yes', 'true'].includes(match[1]);
    
    // Fallback: Check for raw true/false logic
    if (/\b(true|yes)\b/.test(t) && !/\b(false|no)\b/.test(t)) return true;
    if (/\b(false|no)\b/.test(t) && !/\b(true|yes)\b/.test(t)) return false;
    
    return null;
  };

  const stats = useMemo(() => {
    if (!logs.length) return null;

    let s = {
      direct_qa: { total: 0, groundTruthMatches: 0, totalWords: 0, predictedTrue: 0, predictedFalse: 0, actualTrueCorrect: 0, actualTrueTotal: 0, actualFalseCorrect: 0, actualFalseTotal: 0 },
      self_consistency: { total: 0, groundTruthMatches: 0, totalWords: 0, predictedTrue: 0, predictedFalse: 0, actualTrueCorrect: 0, actualTrueTotal: 0, actualFalseCorrect: 0, actualFalseTotal: 0 }
    };

    logs.forEach(log => {
      const gt = String(log.ground_truth).toLowerCase();
      const isGtTrue = ['true', 'yes', '1'].includes(gt);
      const isGtFalse = ['false', 'no', '0'].includes(gt);

      // --- 1. DIRECT QA EVALUATION ---
      const qaText = log.direct_qa || log.direct_qa_response || log.response || log.output;
      if (qaText) {
         let bucket = s.direct_qa;
         bucket.total++;
         if (isGtTrue) bucket.actualTrueTotal++;
         if (isGtFalse) bucket.actualFalseTotal++;

         let stance = extractStance(qaText);

         if (stance === true) bucket.predictedTrue++;
         if (stance === false) bucket.predictedFalse++;

         if (stance !== null) {
            if ((stance && isGtTrue) || (!stance && isGtFalse)) {
               bucket.groundTruthMatches++;
               if (isGtTrue) bucket.actualTrueCorrect++;
               if (isGtFalse) bucket.actualFalseCorrect++;
            }
         }

         bucket.totalWords += String(qaText).split(/\s+/).length;
      }

      // --- 2. SELF CONSISTENCY EVALUATION ---
      const scArray = log.self_consistency || log.self_consistency_responses || log.responses || log.model_responses;
      if (scArray && Array.isArray(scArray) && scArray.length > 0) {
         let bucket = s.self_consistency;
         bucket.total++;
         if (isGtTrue) bucket.actualTrueTotal++;
         if (isGtFalse) bucket.actualFalseTotal++;

         // Calculate Majority Vote automatically
         let tCount = 0; let fCount = 0;
         scArray.forEach(r => {
            const rStance = extractStance(r);
            if (rStance === true) tCount++;
            if (rStance === false) fCount++;
         });
         
         let stance = null;
         if (tCount > fCount) stance = true;
         if (fCount > tCount) stance = false;

         if (stance === true) bucket.predictedTrue++;
         if (stance === false) bucket.predictedFalse++;

         if (stance !== null) {
            if ((stance && isGtTrue) || (!stance && isGtFalse)) {
               bucket.groundTruthMatches++;
               if (isGtTrue) bucket.actualTrueCorrect++;
               if (isGtFalse) bucket.actualFalseCorrect++;
            }
         }

         bucket.totalWords += scArray.join(' ').split(/\s+/).length;
      }
    });

    return s;
  }, [logs]);

  const selectedLog = selectedIndex !== null ? logs[selectedIndex] : null;

  // UI Helpers
  const getLogModes = (log) => {
      let modes = [];
      if (log.direct_qa || log.direct_qa_response || log.response || log.output) modes.push('QA');
      if (log.self_consistency || log.self_consistency_responses || log.responses || log.model_responses || log.n_samples > 1) modes.push('SC');
      return modes;
  };

  const getVerdictForUI = (log, mode) => {
      if (mode === 'SC') {
          const scArray = log.self_consistency || log.self_consistency_responses || log.responses || log.model_responses;
          if (Array.isArray(scArray)) {
              let tCount = 0; let fCount = 0;
              scArray.forEach(r => {
                  const rStance = extractStance(r);
                  if (rStance === true) tCount++;
                  if (rStance === false) fCount++;
              });
              if (tCount > fCount) return "True (Majority)";
              if (fCount > tCount) return "False (Majority)";
              return "Tie / Undetermined";
          }
      } else {
          const txt = log.direct_qa || log.direct_qa_response || log.response || log.output || "";
          const stance = extractStance(txt);
          if (stance !== null) return stance ? "True" : "False";
      }
      return "N/A";
  };

  const renderContentForViewer = (log) => {
      let content = [];
      const qaText = log.direct_qa || log.direct_qa_response || log.response || log.output;
      if (qaText) {
          content.push(`=== DIRECT QA RESPONSE ===\n${qaText}`);
      }
      
      const scArray = log.self_consistency || log.self_consistency_responses || log.responses || log.model_responses;
      if (Array.isArray(scArray)) {
          content.push(`=== SELF CONSISTENCY (${scArray.length} Samples) ===\n` + scArray.map((r, i) => `--- Sample ${i+1} ---\n${r}`).join('\n\n'));
      }
      
      if (content.length === 0) return JSON.stringify(log, null, 2);
      return content.join('\n\n\n');
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 font-sans">
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center shadow-sm z-20">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-600 p-2 rounded-lg text-white"><LayoutDashboard size={20} /></div>
          <h1 className="font-bold text-xl text-slate-800">Baseline Analytics</h1>
        </div>
        {logs.length > 0 && (
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button onClick={() => setActiveTab('viewer')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'viewer' ? 'bg-white text-emerald-700 shadow-sm border border-slate-200' : 'text-slate-600 hover:text-slate-900'}`}><FileText size={16} /> Data Viewer</button>
            <button onClick={() => setActiveTab('analytics')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'analytics' ? 'bg-white text-emerald-700 shadow-sm border border-slate-200' : 'text-slate-600 hover:text-slate-900'}`}><BarChart3 size={16} /> Analytics</button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden flex">
        {logs.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-50">
            <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-6 shadow-sm"><Upload size={40} /></div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Upload Baseline Logs</h2>
            <p className="text-slate-500 mb-6 text-center max-w-sm">Upload your Baseline logs. The suite will detect Direct QA and Self Consistency evaluations automatically.</p>
            <label className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-lg cursor-pointer transition-colors font-medium shadow-md flex items-center gap-2">
              <Upload size={18} /> Browse Files
              <input type="file" accept=".json" className="hidden" onChange={handleFileUpload} />
            </label>
            {error && <p className="text-red-500 text-sm mt-4 flex items-center gap-1 bg-red-50 px-3 py-2 rounded-md border border-red-200"><AlertCircle size={16}/> {error}</p>}
          </div>
        ) : activeTab === 'analytics' ? (
          <div className="flex-1 overflow-y-auto p-8 bg-slate-100">
            <div className="max-w-6xl mx-auto space-y-6">
              
              <div className="flex items-center gap-2 mb-4">
                 <Layers className="text-emerald-600" size={24} />
                 <h2 className="text-2xl font-bold text-slate-800">Strategy Comparison</h2>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {stats && Object.entries(stats).map(([modeKey, m]) => {
                  if (m.total === 0) return null; // Only render if data exists for this mode!

                  const modeName = modeKey === 'direct_qa' ? 'Direct QA' : 'Self-Consistency';
                  const avgWords = Math.round(m.totalWords / m.total);
                  const accuracy = Math.round((m.groundTruthMatches / m.total) * 100);

                  return (
                    <div key={modeKey} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                      <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex justify-between items-center">
                         <h3 className="font-bold text-lg text-slate-800">{modeName}</h3>
                         <span className="text-xs font-semibold bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full border border-emerald-200">
                           {m.total} Records
                         </span>
                      </div>
                      
                      <div className="p-6 space-y-8 flex-1">
                         
                         {/* Core Metrics */}
                         <div className="flex justify-between items-center">
                           <div>
                             <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1 mb-1"><CheckCircle2 size={14}/> Overall Accuracy</p>
                             <p className={`text-4xl font-bold ${accuracy >= 60 ? 'text-emerald-600' : 'text-amber-600'}`}>{accuracy}%</p>
                           </div>
                           <div className="text-right">
                             <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1 mb-1 justify-end"><MessageSquare size={14}/> Avg Output Length</p>
                             <p className="text-3xl font-bold text-slate-700">{avgWords} <span className="text-sm font-normal text-slate-400">words/q</span></p>
                           </div>
                         </div>

                         {/* Accuracy by GT Split */}
                         <div>
                            <p className="text-xs font-bold text-slate-800 uppercase flex items-center gap-1 mb-3"><Target size={14} className="text-emerald-500"/> Accuracy by Ground Truth</p>
                            <div className="space-y-4">
                              <div>
                                <div className="flex justify-between text-sm mb-1 font-medium text-slate-600">
                                  <span>When GT is "True"</span>
                                  <span className="text-emerald-700">{m.actualTrueTotal > 0 ? Math.round((m.actualTrueCorrect / m.actualTrueTotal) * 100) : 0}%</span>
                                </div>
                                <div className="w-full bg-slate-100 rounded-full h-2">
                                  <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${m.actualTrueTotal > 0 ? (m.actualTrueCorrect / m.actualTrueTotal) * 100 : 0}%` }}></div>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1 text-right">{m.actualTrueCorrect} / {m.actualTrueTotal} correct</p>
                              </div>

                              <div>
                                <div className="flex justify-between text-sm mb-1 font-medium text-slate-600">
                                  <span>When GT is "False"</span>
                                  <span className="text-red-700">{m.actualFalseTotal > 0 ? Math.round((m.actualFalseCorrect / m.actualFalseTotal) * 100) : 0}%</span>
                                </div>
                                <div className="w-full bg-slate-100 rounded-full h-2">
                                  <div className="bg-red-400 h-2 rounded-full" style={{ width: `${m.actualFalseTotal > 0 ? (m.actualFalseCorrect / m.actualFalseTotal) * 100 : 0}%` }}></div>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1 text-right">{m.actualFalseCorrect} / {m.actualFalseTotal} correct</p>
                              </div>
                            </div>
                         </div>

                         {/* Answer Bias */}
                         <div className="pt-4 border-t border-slate-100">
                            <p className="text-xs font-bold text-slate-800 uppercase tracking-wide mb-3">Model Answer Bias</p>
                            <div className="flex h-6 rounded-md overflow-hidden shadow-inner">
                               <div 
                                  className="bg-emerald-400 flex items-center justify-center text-xs font-bold text-white transition-all duration-500"
                                  style={{ width: `${Math.max(5, (m.predictedTrue / (m.predictedTrue + m.predictedFalse || 1)) * 100)}%` }}
                               >
                                  {Math.round((m.predictedTrue / (m.predictedTrue + m.predictedFalse || 1)) * 100)}% True
                               </div>
                               <div 
                                  className="bg-red-400 flex items-center justify-center text-xs font-bold text-white transition-all duration-500"
                                  style={{ width: `${Math.max(5, (m.predictedFalse / (m.predictedTrue + m.predictedFalse || 1)) * 100)}%` }}
                               >
                                  {Math.round((m.predictedFalse / (m.predictedTrue + m.predictedFalse || 1)) * 100)}% False
                               </div>
                            </div>
                         </div>

                      </div>
                    </div>
                  );
                })}

              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="w-1/3 max-w-sm bg-white border-r border-slate-200 flex flex-col h-full overflow-hidden">
              <div className="overflow-y-auto flex-1 p-2 space-y-1">
                {logs.map((log, idx) => {
                  const modes = getLogModes(log);
                  return (
                    <button key={idx} onClick={() => setSelectedIndex(idx)} className={`w-full text-left p-3 rounded-lg flex items-start gap-3 transition-colors ${selectedIndex === idx ? 'bg-emerald-50 border border-emerald-200' : 'hover:bg-slate-50 border border-transparent'}`}>
                      <div className="flex flex-col items-center gap-1 mt-0.5">
                        <div className={`flex-shrink-0 w-2 h-2 rounded-full ${log.ground_truth === 'True' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        <span className="text-[9px] font-bold text-slate-400">{modes.join(' & ')}</span>
                      </div>
                      <div className="flex-1 min-w-0"><p className="font-medium text-sm truncate text-slate-800">{log.question}</p></div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
              {selectedLog ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                    <h2 className="text-xl font-bold mb-4 text-slate-900">{selectedLog.question}</h2>
                    <div className="flex flex-wrap gap-4 text-xs font-mono">
                      <span className="bg-slate-100 text-slate-700 px-3 py-1.5 rounded border border-slate-200">GT: {selectedLog.ground_truth}</span>
                      
                      {getLogModes(selectedLog).includes('QA') && (
                        <span className="bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded border border-emerald-200">
                          QA Final: {getVerdictForUI(selectedLog, 'QA')}
                        </span>
                      )}
                      
                      {getLogModes(selectedLog).includes('SC') && (
                        <span className="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded border border-indigo-200">
                          SC Final: {getVerdictForUI(selectedLog, 'SC')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm font-mono text-sm whitespace-pre-wrap leading-relaxed text-slate-800">
                    {renderContentForViewer(selectedLog)}
                  </div>
                </div>
              ) : <div className="h-full flex items-center justify-center text-slate-400">Select a log to view details</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}