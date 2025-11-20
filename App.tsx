
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, Schema } from "@google/genai";

// --- Database Configuration ---
const DB_CONFIG = {
  hostname: 'usdcfscmdn8n01.ajc.bz',
  port: 5432,
  database: 'oneglobe',
  user: 'og_mcp',
  table: 'og_mcp (invoice_raw, sales_plan)'
};

// --- AI Models Configuration ---
const AVAILABLE_MODELS = [
  { id: 'gemini-3-pro-preview', name: 'Gemini 3.0 Pro (Preview)' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-lite-latest', name: 'Gemini 2.5 Flash Lite' },
];

// --- System Instruction ---
const SYSTEM_INSTRUCTION = `You are a friendly, professional, and helpful Data Analyst for 'OneGlobe'. 
Your goal is to assist users by querying the PostgreSQL database.

DATABASE SCHEMA:

1. TABLE og_mcp.invoice_raw (Operational Actuals & Gross Profit)
   Use this table for: Actuals, Invoices, Sales Orders, Gross Profit (GP), Profit, Margin, Volume (lbs/cases).
   Columns:
   - company, invoice_number, invoice_type
   - sales_order_worksheet_number, sales_order_worksheet_line, sales_order_trader, sales_order_price, sales_order_price_uom
   - destination_country, destination_country_name, destination_region, destination_region_name
   - customer_number, customer_name, traffic_coordinator, sale_terms, pickup_city
   - created_by_user, currency_code, sales_order_etd, invoice_date
   - invoice_sale, invoice_profit, invoice_lbs, invoice_cases
   - book_sale, book_profit, book_lbs, book_cases
   - book_set_worksheet_number, purchase_order_worksheet_num, purchase_order_line_number
   - po_trader_id, purchase_order_trader, origin_country, purchase_order_supplier_name
   - fiscal_year, fiscal_month, week_in_month, fiscal_period_start, fiscal_period_end
   - origin_region, purchase_order_price, purchase_order_price_uom, purchase_order_terms
   - xenix, product_code, product_description, product_group, product_proprietary_yes_no
   - product_variety, product_cut, product_subcut, product_brand, product_grade, product_pack, product_size
   - dsch_port, load_port, origin_port, destination_port
   - vendor_number, vessel, voyage_id, last_data_updated, origin_country_name, origin_region_name

2. TABLE og_mcp.sales_plan (Budget & Plan Data)
   Use this table ONLY if the user explicitly mentions "plan", "sales plan", "budget", or "target".
   Columns:
   - destination_region, destination_region_name, destination_country, destination_country_name
   - customer_number, sales_trader, product_group_name, origin_region, origin_region_name
   - fiscal_month, fiscal_year, start_date, end_date
   - gross_profit, metric_tons, product_group_id, customer_name, customer_id
   - master_name, master_id, sales_order_trader

SQL TOOL POLICY (STRICT):
1. Only SELECT queries. Never modify or create data.
2. Case‑insensitive comparisons: When filtering with user text, compare using LOWER(column) vs LOWER('value') OR use ILIKE '%value%'.
3. DATA TYPE SELECTION:
   - Default to 'og_mcp.invoice_raw' for general queries.
   - Use 'og_mcp.sales_plan' only for specific planning/budget questions.
4. RESULT SIZE LIMITS:
   - Hard cap the inline result set to 100 rows: You MUST append 'LIMIT 100' to any query unless the user explicitly asks for a specific number (e.g., "top 10").

RESPONSE GUIDELINES:
1. Return JSON with 'sqlQuery' and 'explanation'.
2. The explanation should be friendly, human-like, and summarize what the data represents.
3. Do not include markdown code blocks in the JSON response.
`;

// --- Schema Definition ---
const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    sqlQuery: { type: Type.STRING },
    explanation: { type: Type.STRING },
  },
  required: ["sqlQuery", "explanation"],
};

// --- Types ---
interface TableData {
  rows: any[];
  fields: string[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  // Properties specific to model responses
  sql?: string;
  data?: TableData;
  error?: string;
  executionTime?: number;
  rating?: number; // 1-5 stars
  isThinking?: boolean; // For loading state within bubble
}

type ConnectionStatus = 'init' | 'connecting' | 'connected' | 'error';

const App: React.FC = () => {
  // --- State ---
  const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0].id);
  
  // AI & DB Status
  const [aiStatus, setAiStatus] = useState<ConnectionStatus>('init');
  const [dbStatus, setDbStatus] = useState<ConnectionStatus>('init');
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Chat Data
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init',
      role: 'model',
      text: `Hola. Soy tu analista de datos de OneGlobe. ¿En qué puedo ayudarte hoy con las facturas o el plan de ventas?`,
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Refs
  const chatSessionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // --- Initialization ---

  // 1. Init AI
  useEffect(() => {
    const initAI = async () => {
      setAiStatus('connecting');
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
        console.error("AI Init Error", e);
        setAiStatus('error');
        setStatusMessage(e.message);
      }
    };
    initAI();
  }, [selectedModel]);

  // 2. Init DB Connection
  useEffect(() => {
    checkDbConnection();
  }, []);

  const checkDbConnection = async () => {
    setDbStatus('connecting');
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (res.ok && data.status === 'connected') {
        setDbStatus('connected');
      } else {
        throw new Error(data.detail || 'Error desconocido');
      }
    } catch (err: any) {
      setDbStatus('error');
      setStatusMessage(err.message || 'No se pudo conectar al backend.');
    }
  };

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- Core Logic ---

  const handleSend = async (e?: React.FormEvent, overrideText?: string) => {
    e?.preventDefault();
    const textToSend = overrideText || inputText;
    
    if (!textToSend.trim() || isProcessing || !chatSessionRef.current) return;

    // 1. Add User Message
    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', text: textToSend }]);
    setInputText('');
    setIsProcessing(true);

    // 2. Add Placeholder Model Message (Thinking...)
    const modelMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { 
      id: modelMsgId, 
      role: 'model', 
      text: '', 
      isThinking: true 
    }]);

    try {
      // 3. Call Gemini
      const result = await chatSessionRef.current.sendMessage({ message: textToSend });
      const jsonResponse = JSON.parse(result.text); // Schema ensures valid JSON
      
      const { sqlQuery, explanation } = jsonResponse;

      // 4. Update Model Message with Explanation & SQL (Still thinking about data)
      setMessages(prev => prev.map(m => {
        if (m.id === modelMsgId) {
          return { ...m, text: explanation, sql: sqlQuery }; // Keep isThinking true while fetching DB
        }
        return m;
      }));

      // 5. Execute SQL on Backend automatically
      const startTime = performance.now();
      const dbRes = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: sqlQuery })
      });

      // Check content type to avoid "JSON at position 4" error if server returns HTML/Text
      const contentType = dbRes.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
          const textError = await dbRes.text();
          throw new Error(`Respuesta del servidor no válida: ${textError}`);
      }

      const dbData = await dbRes.json();
      const endTime = performance.now();

      // 6. Final Update with Data or Error
      setMessages(prev => prev.map(m => {
        if (m.id === modelMsgId) {
          return {
            ...m,
            isThinking: false,
            data: dbRes.ok ? { rows: dbData.rows, fields: dbData.fields } : undefined,
            error: dbRes.ok ? undefined : (dbData.error || 'Error ejecutando consulta'),
            executionTime: endTime - startTime
          };
        }
        return m;
      }));

    } catch (error: any) {
      console.error(error);
      setMessages(prev => prev.map(m => {
        if (m.id === modelMsgId) {
          return {
            ...m,
            isThinking: false,
            text: m.text || "Lo siento, tuve un problema procesando tu solicitud.",
            error: error.message
          };
        }
        return m;
      }));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRating = (msgId: string, rating: number) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, rating } : m));
  };

  const handleHistoryClick = (text: string) => {
    if (isProcessing) return;
    handleSend(undefined, text);
  };

  // --- Render Helpers ---

  const renderStars = (msg: ChatMessage) => {
    return (
      <div className="flex items-center gap-1 mt-3 pt-3 border-t border-slate-100">
        <span className="text-[10px] text-slate-400 uppercase font-bold mr-2">Calificar respuesta:</span>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => handleRating(msg.id, star)}
            className={`w-5 h-5 transition-all hover:scale-110 ${
              (msg.rating || 0) >= star ? 'text-yellow-400' : 'text-slate-200 hover:text-yellow-200'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
              <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.005Z" clipRule="evenodd" />
            </svg>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800 overflow-hidden">
      
      {/* --- Sidebar --- */}
      <aside className="w-72 bg-slate-900 text-slate-300 flex flex-col shadow-2xl z-30">
        <div className="p-5 bg-slate-950 border-b border-slate-800">
          <h1 className="text-white font-bold text-lg tracking-tight flex items-center gap-2">
            <div className="bg-blue-600 rounded-lg p-1.5">
               <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white">
                 <path fillRule="evenodd" d="M4.125 3C3.089 3 2.25 3.84 2.25 4.875V18a3 3 0 003 3h15a3 3 0 01-3-3V4.875C17.25 3.84 16.411 3 15.375 3H4.125zM12 9.75a.75.75 0 000 1.5h1.5a.75.75 0 000-1.5H12zm-.75-2.25a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5H12a.75.75 0 01-.75-.75zM6 12.75a.75.75 0 000 1.5h7.5a.75.75 0 000-1.5H6zm-.75 3.75a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5H6a.75.75 0 01-.75-.75zM6 6.75a.75.75 0 000 1.5h3a.75.75 0 000-1.5H6z" clipRule="evenodd" />
               </svg>
            </div>
            Invoice Chat
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
          
          {/* Status Indicators */}
          <div className="space-y-3">
             <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                <span>Estado del Sistema</span>
             </div>
             
             {/* AI Status */}
             <div className={`flex items-center gap-3 p-2.5 rounded-md border ${aiStatus === 'error' ? 'bg-red-900/20 border-red-900/40' : 'bg-slate-800/50 border-slate-700'}`}>
                <div className={`w-2 h-2 rounded-full ${aiStatus === 'connected' ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.5)]' : aiStatus === 'connecting' ? 'bg-blue-400 animate-pulse' : 'bg-red-500'}`} />
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-slate-200">Modelo IA</span>
                  <span className="text-[10px] text-slate-500">{aiStatus === 'connected' ? 'Conectado' : 'Error'}</span>
                </div>
             </div>

             {/* DB Status */}
             <div className={`flex items-center gap-3 p-2.5 rounded-md border ${dbStatus === 'error' ? 'bg-red-900/20 border-red-900/40' : 'bg-slate-800/50 border-slate-700'}`}>
                <div className={`w-2 h-2 rounded-full ${dbStatus === 'connected' ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.5)]' : dbStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' : 'bg-red-500'}`} />
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-slate-200">Base de Datos</span>
                  <span className="text-[10px] text-slate-500">{dbStatus === 'connected' ? 'Conectado' : 'Desconectado'}</span>
                </div>
             </div>

             {/* DB Info Card */}
             <div className="p-2.5 rounded-md border bg-slate-800/30 border-slate-700">
                <div className="grid grid-cols-[40px_1fr] gap-y-1 text-[10px]">
                   <span className="text-slate-500">Host</span>
                   <span className="text-slate-300 truncate" title={DB_CONFIG.hostname}>{DB_CONFIG.hostname}</span>
                   
                   <span className="text-slate-500">DB</span>
                   <span className="text-blue-400 font-mono">{DB_CONFIG.database}</span>

                   <span className="text-slate-500">Tablas</span>
                   <span className="text-yellow-400 font-mono truncate" title={DB_CONFIG.table}>{DB_CONFIG.table}</span>
                </div>
             </div>
             
             {statusMessage && (dbStatus === 'error' || aiStatus === 'error') && (
                <div className="text-[10px] text-red-400 bg-red-950/30 p-2 rounded border border-red-900/30">
                  {statusMessage}
                </div>
             )}
          </div>

          {/* History */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Historial de Preguntas</h3>
            <div className="space-y-1">
              {messages.filter(m => m.role === 'user').slice(-10).reverse().map((m) => (
                <button 
                  key={m.id} 
                  onClick={() => handleHistoryClick(m.text)}
                  disabled={isProcessing}
                  className="w-full text-left group flex items-start gap-2 p-2 rounded-md hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  <span className="mt-0.5 text-slate-500 group-hover:text-blue-400">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h3.25a.75.75 0 00.75-.75v-3.25z" clipRule="evenodd" />
                    </svg>
                  </span>
                  <span className="text-xs text-slate-400 group-hover:text-slate-200 line-clamp-2 leading-relaxed">
                    {m.text}
                  </span>
                </button>
              ))}
              {messages.filter(m => m.role === 'user').length === 0 && (
                <p className="text-[10px] text-slate-600 italic px-2">No hay consultas recientes.</p>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* --- Main Content --- */}
      <main className="flex-1 flex flex-col min-w-0 bg-white relative">
        
        {/* Header */}
        <header className="h-14 border-b border-slate-100 flex items-center px-6 justify-between bg-white/80 backdrop-blur-sm sticky top-0 z-20">
           <div className="flex items-center gap-2">
             <span className="text-slate-400 text-sm font-medium">Modelo Activo:</span>
             <select 
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold uppercase rounded py-1 pl-2 pr-6 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
             >
               {AVAILABLE_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
             </select>
           </div>
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50 scroll-smooth">
           {messages.map((msg) => (
             <div 
                key={msg.id} 
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-4 duration-500`}
             >
                {msg.role === 'model' && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex-shrink-0 flex items-center justify-center text-white shadow-lg mr-3 mt-1">
                     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                       <path fillRule="evenodd" d="M9.315 7.584C12.195 3.883 16.695 1.5 21.75 1.5a.75.75 0 01.75.75c0 5.056-2.383 9.555-6.084 12.436h.675c4.24 0 8.042 2.496 9.844 6.396a.75.75 0 01-.921 1.015 24.56 24.56 0 00-7.624-1.358 24.556 24.556 0 00-7.624 1.358.75.75 0 01-.921-1.015c1.802-3.9 5.604-6.396 9.844-6.396h.675C11.868 11.783 9.485 7.283 9.315 7.584zM6.134 16.053c2.02-3.216 5.122-5.353 8.636-5.932C13.305 7.11 11.234 4.01 9.705 2.481a.75.75 0 00-1.06 0C3.06 8.065 1.5 14.858 1.5 21.75a.75.75 0 00.75.75c4.062 0 7.721-1.153 10.83-3.195a.75.75 0 00-1.041-1.057 21.04 21.04 0 01-5.905 1.805v-4z" clipRule="evenodd" />
                     </svg>
                  </div>
                )}

                <div className={`max-w-4xl ${msg.role === 'user' ? 'bg-blue-600 text-white shadow-blue-200' : 'bg-white text-slate-700 border border-slate-200 shadow-slate-100'} shadow-lg rounded-2xl p-5 relative group`}>
                   
                   {/* Text Content */}
                   <div className="text-sm leading-relaxed whitespace-pre-wrap">
                      {msg.text}
                   </div>
                   
                   {/* Thinking / Processing State */}
                   {msg.isThinking && (
                      <div className="mt-4 flex items-center gap-2 text-xs text-slate-400 font-mono">
                         <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0ms'}} />
                         <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '150ms'}} />
                         <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '300ms'}} />
                         <span>Analizando datos...</span>
                      </div>
                   )}

                   {/* Error State */}
                   {msg.error && (
                      <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-lg text-red-600 text-xs flex items-start gap-2">
                         <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mt-0.5 flex-shrink-0"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                         {msg.error}
                      </div>
                   )}

                   {/* Table Results (Inline) */}
                   {msg.data && msg.data.rows.length > 0 && (
                      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 shadow-sm bg-slate-50">
                         <div className="overflow-x-auto max-h-64 custom-scrollbar">
                           <table className="w-full text-xs text-left whitespace-nowrap">
                              <thead className="bg-slate-100 text-slate-500 sticky top-0 z-10 font-semibold">
                                 <tr>
                                   {msg.data.fields.map(f => (
                                      <th key={f} className="px-4 py-2 border-b border-slate-200 uppercase tracking-wider">{f}</th>
                                   ))}
                                 </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 bg-white">
                                 {msg.data.rows.map((row, i) => (
                                    <tr key={i} className="hover:bg-blue-50 transition-colors">
                                       {msg.data!.fields.map(f => (
                                          <td key={f} className="px-4 py-2 text-slate-600">{row[f] ?? '-'}</td>
                                       ))}
                                    </tr>
                                 ))}
                              </tbody>
                           </table>
                         </div>
                         <div className="bg-slate-50 px-3 py-1.5 border-t border-slate-200 text-[10px] text-slate-400 flex justify-between items-center">
                            <span>{msg.data.rows.length} resultados</span>
                            <span>{msg.executionTime?.toFixed(0)}ms</span>
                         </div>
                      </div>
                   )}
                   
                   {/* Empty Result Case */}
                   {msg.data && msg.data.rows.length === 0 && !msg.error && (
                      <div className="mt-3 px-3 py-2 bg-yellow-50 text-yellow-700 text-xs rounded border border-yellow-100">
                         La consulta se ejecutó correctamente pero no arrojó resultados.
                      </div>
                   )}

                   {/* Ranking System */}
                   {msg.role === 'model' && !msg.isThinking && renderStars(msg)}

                </div>
             </div>
           ))}
           <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-slate-100 relative z-30 shadow-[0_-5px_20px_rgba(0,0,0,0.03)]">
          <form onSubmit={(e) => handleSend(e)} className="max-w-4xl mx-auto relative">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={isProcessing ? "Procesando..." : "Pregunta sobre facturación, clientes o ventas..."}
              disabled={isProcessing}
              className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-full py-3.5 pl-6 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-inner transition-all disabled:opacity-60 placeholder:text-slate-400"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isProcessing}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 bg-blue-600 text-white rounded-full shadow-md hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 disabled:shadow-none"
            >
               {isProcessing ? (
                 <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
               ) : (
                 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                   <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                 </svg>
               )}
            </button>
          </form>
        </div>

      </main>
    </div>
  );
};

export default App;
