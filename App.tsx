
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, Schema } from "@google/genai";

// --- Database Configuration ---
const DB_CONFIG = {
  hostname: 'usdcfscmdn8n01.ajc.bz',
  port: 5432,
  database: 'oneglobe',
  user: 'og_mcp',
  password: 'og_mcp', // Not used in frontend anymore, handled by backend
  table: 'invoice_raw'
};

// --- AI Models Configuration ---
const AVAILABLE_MODELS = [
  { id: 'gemini-3-pro-preview', name: 'Gemini 3.0 Pro (Preview)' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-lite-latest', name: 'Gemini 2.5 Flash Lite' },
];

// --- System Instruction ---
const SYSTEM_INSTRUCTION = `You are an expert PostgreSQL Data Analyst. 
Your task is to generate valid PostgreSQL SQL queries based on natural language user requests.
You are working with a specific table named '${DB_CONFIG.table}'.
Assume the table '${DB_CONFIG.table}' has standard invoice columns like: id, customer_name, invoice_date, amount, currency, status, due_date.

Response Rules:
1. ONLY generate the SQL query.
2. Provide a brief explanation of what the query does.
3. Always output in JSON format.
4. Do not include markdown code blocks (like \`\`\`json) in the response, just the raw JSON object.
`;

// --- Schema Definition for Gemini ---
const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    sqlQuery: {
      type: Type.STRING,
      description: "The executable PostgreSQL query",
    },
    explanation: {
      type: Type.STRING,
      description: "A brief explanation of the logic",
    },
  },
  required: ["sqlQuery", "explanation"],
};

// --- Types ---
interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string | { sqlQuery: string; explanation: string };
  isError?: boolean;
}

type ConnectionStatus = 'init' | 'connecting' | 'connected' | 'error';

const App: React.FC = () => {
  // AI Configuration State
  const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0].id);
  const [aiStatus, setAiStatus] = useState<ConnectionStatus>('init');
  const [aiErrorDetail, setAiErrorDetail] = useState<string | null>(null);

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init',
      role: 'model',
      content: {
        sqlQuery: `-- El historial de consultas aparecerá aquí`,
        explanation: `Hola. Estoy listo para generar consultas SQL sobre la tabla ${DB_CONFIG.table}.`
      }
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Execution State
  const [isExecuting, setIsExecuting] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [queryResults, setQueryResults] = useState<any[]>([]);
  const [queryFields, setQueryFields] = useState<string[]>([]);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryTime, setQueryTime] = useState<number>(0);

  // Database Connection State
  const [dbStatus, setDbStatus] = useState<ConnectionStatus>('init');
  const [dbError, setDbError] = useState<string | null>(null);
  
  // Refs
  const chatSessionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize AI when model changes
  useEffect(() => {
    const initAI = async () => {
      setAiStatus('connecting');
      setAiErrorDetail(null);
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        chatSessionRef.current = ai.chats.create({
          model: selectedModel,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        });
        setAiStatus('connected');
      } catch (e: any) {
        console.error("Error init AI", e);
        setAiStatus('error');
        setAiErrorDetail(e.message || "Error desconocido al inicializar el cliente de IA.");
      }
    };
    initAI();
  }, [selectedModel]);

  // Connect to Backend (Proxy to DB)
  useEffect(() => {
    connectToDatabase();
  }, []);

  const connectToDatabase = async () => {
    setDbStatus('connecting');
    setDbError(null);

    try {
      // Call our local backend health check
      const response = await fetch('/api/health');
      const data = await response.json();

      if (response.ok && data.status === 'connected') {
        setDbStatus('connected');
      } else {
        setDbStatus('error');
        setDbError(data.message || data.detail || 'Error connecting to backend service.');
      }
    } catch (err: any) {
      console.error("DB Connection Check Error", err);
      setDbStatus('error');
      setDbError('No se pudo contactar con el servidor backend (Port 3001). Asegúrate de haber iniciado "node server.js".');
    }
  };

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || isGenerating || !chatSessionRef.current) return;

    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', content: inputText }]);
    setInputText('');
    setIsGenerating(true);
    setShowResults(false);
    setAiErrorDetail(null);
    
    if (aiStatus === 'error') {
        setAiStatus('connected'); 
    }

    try {
      const result = await chatSessionRef.current.sendMessage({ message: inputText });
      const textResponse = result.text;
      
      if (textResponse) {
        const parsed = JSON.parse(textResponse);
        setMessages(prev => [...prev, { 
          id: (Date.now() + 1).toString(), 
          role: 'model', 
          content: parsed 
        }]);
      }
    } catch (error: any) {
      console.error(error);
      setAiStatus('error');
      setAiErrorDetail(error.message || "Error al comunicarse con la API de Gemini.");
      
      setMessages(prev => [...prev, { 
        id: Date.now().toString(), 
        role: 'model', 
        content: { sqlQuery: '-- Error generating query', explanation: 'Ocurrió un error crítico al comunicarse con el modelo. Revisa el panel lateral para más detalles.' },
        isError: true 
      }]);
    } finally {
      setIsGenerating(false);
    }
  };

  const executeQuery = async () => {
    setIsExecuting(true);
    setQueryError(null);
    setQueryResults([]);
    setQueryFields([]);
    setShowResults(true);
    
    const startTime = performance.now();

    const lastModelMessage = [...messages].reverse().find(m => m.role === 'model');
    const currentSQL = typeof lastModelMessage?.content === 'object' ? lastModelMessage.content.sqlQuery : '';

    try {
        const response = await fetch('/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: currentSQL })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error ejecutando la consulta');
        }

        setQueryResults(data.rows || []);
        setQueryFields(data.fields || []);
        setQueryTime(performance.now() - startTime);

    } catch (err: any) {
        setQueryError(err.message);
    } finally {
        setIsExecuting(false);
    }
  };

  const lastModelMessage = [...messages].reverse().find(m => m.role === 'model');
  const currentSQL = typeof lastModelMessage?.content === 'object' ? lastModelMessage.content.sqlQuery : '';

  // Helpers for UI
  const getDbStatusColor = () => {
    if (dbStatus === 'connecting') return 'bg-yellow-400 animate-pulse';
    if (dbStatus === 'connected') return 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]';
    if (dbStatus === 'error') return 'bg-red-500';
    return 'bg-slate-400';
  };

  const getAiStatusColor = () => {
    if (aiStatus === 'connecting') return 'bg-blue-400 animate-pulse';
    if (aiStatus === 'connected') return 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]';
    if (aiStatus === 'error') return 'bg-red-500';
    return 'bg-slate-400';
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800 overflow-hidden">
      
      {/* Sidebar: Context & Settings */}
      <aside className="w-80 bg-slate-900 text-slate-300 flex flex-col shadow-xl z-20">
        <div className="p-6 border-b border-slate-800 bg-slate-950">
          <h1 className="text-white font-bold text-xl tracking-tight flex items-center gap-2">
            <span className="text-blue-500 text-2xl">⌗</span> Invoice Chat
          </h1>
          <p className="text-xs text-slate-500 mt-1">PostgreSQL Client</p>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-8">
          
          {/* AI Status Panel */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Estado IA (Gemini)</h3>
            <div className={`flex items-center gap-3 p-3 rounded-lg border mb-3 ${aiStatus === 'error' ? 'bg-red-900/10 border-red-900/30' : 'bg-slate-800 border-slate-700'}`}>
              <div className={`w-2.5 h-2.5 rounded-full ${getAiStatusColor()}`}></div>
              <span className={`text-sm font-medium ${aiStatus === 'error' ? 'text-red-400' : 'text-white'}`}>
                {aiStatus === 'connecting' ? 'Iniciando...' : aiStatus === 'connected' ? 'Operativo' : 'Error de API'}
              </span>
            </div>
            {aiStatus === 'error' && aiErrorDetail && (
               <div className="p-3 bg-red-950/50 border border-red-900/50 rounded-lg animate-in fade-in zoom-in-95">
                  <div className="text-[10px] font-mono text-red-300 break-words leading-relaxed">
                    {aiErrorDetail}
                  </div>
               </div>
            )}
          </div>

          {/* Database Status Panel */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Estado Base de Datos</h3>
              <button 
                onClick={connectToDatabase}
                className="text-xs text-blue-400 hover:text-blue-300 hover:underline disabled:opacity-50"
                disabled={dbStatus === 'connecting'}
              >
                Reconectar
              </button>
            </div>
            
            <div className="space-y-3">
              <div className={`flex items-center gap-3 p-3 rounded-lg border ${dbStatus === 'error' ? 'bg-red-900/10 border-red-900/30' : 'bg-slate-800 border-slate-700'}`}>
                <div className={`w-2.5 h-2.5 rounded-full ${getDbStatusColor()}`}></div>
                <span className={`text-sm font-medium ${dbStatus === 'error' ? 'text-red-400' : 'text-white'}`}>
                  {dbStatus === 'connecting' ? 'Conectando...' : dbStatus === 'connected' ? 'Online' : 'Error de Conexión'}
                </span>
              </div>
              
              {/* DB Connection Info */}
              <div className="bg-slate-800 rounded-lg p-4 font-mono text-xs space-y-3 border border-slate-700 shadow-inner">
                <div className="flex justify-between items-center border-b border-slate-700/50 pb-2">
                  <span className="text-slate-500">Host</span>
                  <span className="text-slate-300 truncate max-w-[120px]" title={DB_CONFIG.hostname}>{DB_CONFIG.hostname}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-700/50 pb-2">
                  <span className="text-slate-500">Port</span>
                  <span className="text-slate-300">{DB_CONFIG.port}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-700/50 pb-2">
                  <span className="text-slate-500">DB</span>
                  <span className="text-blue-400">{DB_CONFIG.database}</span>
                </div>
                 <div className="flex justify-between items-center pt-1">
                  <span className="text-slate-500">Table</span>
                  <span className="text-yellow-500 font-bold">{DB_CONFIG.table}</span>
                </div>
              </div>

              {dbStatus === 'error' && dbError && (
                <div className="mt-2 p-3 bg-red-950/50 border border-red-900/50 rounded-lg">
                   <div className="text-[10px] font-mono text-red-300 break-words leading-relaxed">
                     {dbError}
                   </div>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-slate-800 pt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">Historial Reciente</h3>
            <div className="space-y-2">
              {messages.filter(m => m.role === 'user').slice(-5).reverse().map(m => (
                <div key={m.id} className="text-xs p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 rounded cursor-pointer truncate transition-colors">
                  {typeof m.content === 'string' ? m.content : ''}
                </div>
              ))}
              {messages.filter(m => m.role === 'user').length === 0 && (
                <p className="text-xs text-slate-600 italic">Sin historial.</p>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        
        {/* Top Bar */}
        <header className="h-16 border-b border-slate-200 bg-white flex items-center px-6 justify-between z-10 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label htmlFor="model-select" className="text-xs font-bold uppercase text-slate-400 tracking-wide">Modelo:</label>
              <div className="relative">
                <select 
                  id="model-select"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="appearance-none bg-slate-50 border border-slate-200 text-slate-700 text-sm font-semibold py-1.5 pl-3 pr-8 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer hover:bg-white hover:border-slate-300 transition-colors"
                >
                  {AVAILABLE_MODELS.map(model => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                </div>
              </div>
            </div>

            <span className="text-slate-300">|</span>
            
            <span className="text-slate-800 flex items-center gap-2 text-sm">
              <span className={`w-1.5 h-1.5 rounded-full ${dbStatus === 'connected' ? 'bg-green-500' : 'bg-red-500'}`}></span>
              {dbStatus === 'connected' ? 'Editor SQL (Conectado)' : 'Editor SQL (Desconectado)'}
            </span>
          </div>

          <div className="flex items-center gap-3">
             <button 
               className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium rounded-lg shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
               onClick={executeQuery}
               disabled={isExecuting || !currentSQL || currentSQL.startsWith('--') || dbStatus !== 'connected'}
             >
               {isExecuting ? (
                 <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
               ) : (
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                   <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                 </svg>
               )}
               Ejecutar Query
             </button>
          </div>
        </header>

        {/* Workspace */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          
          {/* Messages Area (Chat & Code) */}
          <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-slate-50/50">
            {messages.map((msg) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="flex justify-end animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="bg-white border border-slate-200 text-slate-700 py-3 px-5 rounded-2xl rounded-tr-sm shadow-sm max-w-2xl text-sm leading-relaxed">
                      {msg.content as string}
                    </div>
                  </div>
                );
              }
              
              // Model Message
              const content = msg.content as { sqlQuery: string; explanation: string };
              return (
                <div key={msg.id} className="flex flex-col gap-3 max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center gap-2 ml-1">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shadow-md ${msg.isError ? 'bg-red-500' : 'bg-gradient-to-tr from-blue-500 to-indigo-600'}`}>
                      {msg.isError ? (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                      ) : (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      )}
                    </div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                      {msg.isError ? 'Error de Sistema' : 'Generado por Gemini'}
                    </span>
                  </div>
                  
                  <div className={`bg-white border rounded-xl shadow-sm overflow-hidden group ${msg.isError ? 'border-red-200' : 'border-slate-200'}`}>
                    {/* Explanation Header */}
                    <div className={`px-5 py-4 border-b text-sm leading-relaxed ${msg.isError ? 'bg-red-50 text-red-700 border-red-100' : 'bg-slate-50/80 text-slate-600 border-slate-100'}`}>
                      {content.explanation}
                    </div>
                    {/* Code Block */}
                    <div className="relative">
                      <div className="p-5 bg-[#1e1e1e] text-blue-300 font-mono text-sm overflow-x-auto custom-scrollbar">
                        <pre className="whitespace-pre-wrap">{content.sqlQuery}</pre>
                      </div>
                      {!msg.isError && (
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-[10px] text-gray-500 bg-black/20 px-2 py-1 rounded">SQL</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Query Results Panel (Real Data) */}
          {showResults && (
            <div className="h-72 border-t border-slate-200 bg-white flex flex-col animate-in slide-in-from-bottom-10 duration-300 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Resultados</h4>
                  {queryError ? (
                     <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded border border-red-200 font-medium">ERROR</span>
                  ) : (
                     <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded border border-green-200 font-medium">EXITO</span>
                  )}
                </div>
                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 font-mono">
                  {queryResults.length} rows • {queryTime.toFixed(2)}ms
                </span>
              </div>
              
              <div className="overflow-auto flex-1 p-0">
                {queryError ? (
                    <div className="p-6 text-red-500 font-mono text-sm">
                        {queryError}
                    </div>
                ) : queryResults.length > 0 ? (
                    <table className="w-full text-sm text-left border-collapse">
                    <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10 shadow-sm">
                        <tr>
                        {queryFields.map((field) => (
                            <th key={field} className="px-6 py-3 font-medium border-b text-xs uppercase tracking-wider whitespace-nowrap">
                                {field}
                            </th>
                        ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {queryResults.map((row, idx) => (
                        <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                            {queryFields.map((field) => (
                                <td key={`${idx}-${field}`} className="px-6 py-3 text-slate-700 whitespace-nowrap">
                                    {row[field] !== null ? String(row[field]) : <span className="text-slate-300 italic">null</span>}
                                </td>
                            ))}
                        </tr>
                        ))}
                    </tbody>
                    </table>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm">
                        <p>La consulta no devolvió resultados.</p>
                    </div>
                )}
              </div>
            </div>
          )}
          
          {/* Input Area */}
          <div className="p-6 bg-white border-t border-slate-200 z-20">
            <form onSubmit={handleSend} className="relative max-w-4xl mx-auto">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={isGenerating ? "Generando consulta..." : "¿Qué datos necesitas consultar hoy?"}
                disabled={isGenerating}
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-base rounded-xl py-4 pl-6 pr-14 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm transition-all placeholder:text-slate-400 disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || isGenerating}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 disabled:bg-slate-300"
              >
                {isGenerating ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                  </svg>
                )}
              </button>
            </form>
            <p className="text-center text-xs text-slate-400 mt-3">
              Gemini 3.0 Pro puede cometer errores. Verifica las consultas SQL antes de ejecutarlas.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
