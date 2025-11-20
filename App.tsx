import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, Schema } from "@google/genai";

// --- Database Configuration ---
const DB_CONFIG = {
  hostname: 'usdcfscmdn8n01.ajc.bz',
  port: 5432,
  database: 'oneglobe',
  user: 'og_mcp',
  password: 'og_mcp',
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
  const [isExecuting, setIsExecuting] = useState(false);
  const [showResults, setShowResults] = useState(false);

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
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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

  // Simulate DB Connection on Mount
  useEffect(() => {
    connectToDatabase();
  }, []);

  const connectToDatabase = () => {
    setDbStatus('connecting');
    setDbError(null);

    // Simulate a connection attempt
    setTimeout(() => {
      // En un entorno frontend real, no podemos conectar directamente a Postgres por TCP.
      setDbStatus('error');
      setDbError(`OperationalError: connection to server at "${DB_CONFIG.hostname}", port ${DB_CONFIG.port} failed: Connection timed out.\n\nDetail: Direct TCP connections to PostgreSQL are not supported from browser environments due to security sandboxing.`);
    }, 2500);
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
    setAiErrorDetail(null); // Clear transient AI errors
    
    if (aiStatus === 'error') {
        setAiStatus('connected'); // Retry state visually if user tries again
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

  // --- Mock Execution Function ---
  const executeQuery = () => {
    setIsExecuting(true);
    // Simulate network delay
    setTimeout(() => {
      setShowResults(true);
      setIsExecuting(false);
    }, 1000);
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
                Reintentar
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
            
            <span className={`${dbStatus === 'error' ? 'text-amber-600' : 'text-slate-800'} flex items-center gap-2 text-sm`}>
              {dbStatus === 'error' && <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>}
              {dbStatus === 'error' ? 'Modo Offline' : 'Editor SQL'}
            </span>
          </div>

          <div className="flex items-center gap-3">
             <button 
               className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium rounded-lg shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
               onClick={executeQuery}
               disabled={isExecuting || !currentSQL || currentSQL.startsWith('--')}
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

          {/* Query Results Panel (Conditional) */}
          {showResults && (
            <div className="h-72 border-t border-slate-200 bg-white flex flex-col animate-in slide-in-from-bottom-10 duration-300 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Resultados</h4>
                  {dbStatus === 'error' && (
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200 font-medium">
                      SIMULADO
                    </span>
                  )}
                </div>
                <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-100 font-mono">
                  4 rows • 0.12s
                </span>
              </div>
              <div className="overflow-auto flex-1 p-0">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="px-6 py-3 font-medium border-b text-xs uppercase tracking-wider">ID</th>
                      <th className="px-6 py-3 font-medium border-b text-xs uppercase tracking-wider">Customer</th>
                      <th className="px-6 py-3 font-medium border-b text-xs uppercase tracking-wider">Date</th>
                      <th className="px-6 py-3 font-medium border-b text-xs uppercase tracking-wider text-right">Amount</th>
                      <th className="px-6 py-3 font-medium border-b text-xs uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[101, 102, 103, 104].map((id, idx) => (
                      <tr key={id} className="hover:bg-blue-50/30 transition-colors">
                        <td className="px-6 py-3 font-mono text-slate-500 text-xs">#{id}</td>
                        <td className="px-6 py-3 text-slate-700 font-medium">
                          {['Acme Corp', 'Globex Inc', 'Soylent Corp', 'Initech'][idx]}
                        </td>
                        <td className="px-6 py-3 text-slate-500">2024-02-{10 + idx}</td>
                        <td className="px-6 py-3 font-mono text-slate-700 text-right">
                          ${(1200.50 + (idx * 350)).toFixed(2)}
                        </td>
                        <td className="px-6 py-3">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            idx % 2 === 0 
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                              : 'bg-amber-50 text-amber-700 border-amber-100'
                          }`}>
                            {idx % 2 === 0 ? 'PAID' : 'PENDING'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Input Area */}
          <div className="p-4 bg-white border-t border-slate-200">
            <form onSubmit={handleSend} className="relative max-w-5xl mx-auto">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Describe los datos que necesitas (ej: 'Ventas totales agrupadas por cliente de este mes')..."
                disabled={isGenerating}
                className="w-full bg-slate-50 hover:bg-white focus:bg-white text-slate-900 placeholder-slate-400 border border-slate-200 hover:border-slate-300 rounded-xl py-4 pl-5 pr-14 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm transition-all"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || isGenerating}
                className="absolute right-2 top-2 bottom-2 aspect-square bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-300 shadow-sm"
              >
                {isGenerating ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            </form>
            <div className="text-center mt-2">
              <p className="text-[10px] text-slate-400">
                {dbStatus === 'error' ? '⚠ Conexión DB fallida. Modo offline.' : 'Conexión DB establecida.'}
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;