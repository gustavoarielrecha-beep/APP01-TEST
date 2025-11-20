import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, Schema } from "@google/genai";

// --- Database Configuration ---
const DB_CONFIG = {
  hostname: 'usdcfscmdn8n01.ajc.bz',
  port: 5432,
  database: 'oneglobe',
  user: 'og_mcp',
  table: 'invoice_raw'
};

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

// --- Schema Definition for Gemini 3.0 ---
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

interface MockResultRow {
  id: number;
  customer: string;
  date: string;
  amount: string;
  status: string;
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init',
      role: 'model',
      content: {
        sqlQuery: `-- El historial de consultas aparecerá aquí`,
        explanation: `Hola. Estoy conectado a ${DB_CONFIG.database}. Pídeme generar reportes, por ejemplo: "Muestra las facturas pendientes de este mes".`
      }
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  
  // Ref for Chat Session
  const chatSessionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initAI = async () => {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        chatSessionRef.current = ai.chats.create({
          model: 'gemini-3-pro-preview',
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        });
      } catch (e) {
        console.error("Error init AI", e);
      }
    };
    initAI();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || isLoading || !chatSessionRef.current) return;

    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', content: inputText }]);
    setInputText('');
    setIsLoading(true);
    setShowResults(false);

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
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { 
        id: Date.now().toString(), 
        role: 'model', 
        content: { sqlQuery: '-- Error', explanation: 'No se pudo generar la consulta.' },
        isError: true 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Mock Execution Function ---
  const executeQuery = () => {
    setIsLoading(true);
    // Simulate network delay
    setTimeout(() => {
      setShowResults(true);
      setIsLoading(false);
    }, 1000);
  };

  const lastModelMessage = [...messages].reverse().find(m => m.role === 'model');
  const currentSQL = typeof lastModelMessage?.content === 'object' ? lastModelMessage.content.sqlQuery : '';
  const currentExplanation = typeof lastModelMessage?.content === 'object' ? lastModelMessage.content.explanation : '';

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800 overflow-hidden">
      
      {/* Sidebar: Database Context */}
      <aside className="w-72 bg-slate-900 text-slate-300 flex flex-col shadow-xl">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-white font-bold text-xl tracking-tight flex items-center gap-2">
            <span className="text-blue-500 text-2xl">⌗</span> Invoice Chat
          </h1>
          <p className="text-xs text-slate-500 mt-1">SQL Generator</p>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          <div className="mb-8">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">Conexión Activa</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                <span className="text-white font-medium">PostgreSQL</span>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 font-mono text-xs space-y-2 border border-slate-700">
                <div className="flex justify-between">
                  <span className="text-slate-500">Host:</span>
                  <span className="text-slate-300 truncate max-w-[100px]">{DB_CONFIG.hostname}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">DB:</span>
                  <span className="text-blue-400">{DB_CONFIG.database}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">User:</span>
                  <span className="text-slate-300">{DB_CONFIG.user}</span>
                </div>
                 <div className="flex justify-between">
                  <span className="text-slate-500">Table:</span>
                  <span className="text-yellow-500">{DB_CONFIG.table}</span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">Historial Reciente</h3>
            <div className="space-y-2">
              {messages.filter(m => m.role === 'user').slice(-5).reverse().map(m => (
                <div key={m.id} className="text-xs p-2 hover:bg-slate-800 rounded cursor-pointer truncate border-l-2 border-transparent hover:border-blue-500 transition-colors">
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
      <main className="flex-1 flex flex-col min-w-0">
        
        {/* Top Bar */}
        <header className="h-16 border-b border-slate-200 bg-white flex items-center px-6 justify-between">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <span>Gemini 3.0 Pro</span>
            <span className="text-slate-300">/</span>
            <span className="text-slate-800 font-medium">Editor SQL</span>
          </div>
          <div className="flex items-center gap-3">
             <button 
               className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
               onClick={executeQuery}
               disabled={isLoading || !currentSQL || currentSQL.startsWith('--')}
             >
               <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                 <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
               </svg>
               Ejecutar Query
             </button>
          </div>
        </header>

        {/* Workspace */}
        <div className="flex-1 flex flex-col overflow-hidden">
          
          {/* Messages Area (Chat & Code) */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50">
            {messages.map((msg) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="bg-white border border-slate-200 py-3 px-5 rounded-2xl rounded-tr-none shadow-sm max-w-2xl text-sm">
                      {msg.content as string}
                    </div>
                  </div>
                );
              }
              
              // Model Message (SQL Display)
              const content = msg.content as { sqlQuery: string; explanation: string };
              return (
                <div key={msg.id} className="flex flex-col gap-2 max-w-3xl">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center text-[10px] text-white font-bold">AI</div>
                    <span className="text-xs font-semibold text-slate-500">Gemini</span>
                  </div>
                  
                  <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    {/* Explanation Header */}
                    <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 text-sm text-slate-600">
                      {content.explanation}
                    </div>
                    {/* Code Block */}
                    <div className="p-4 bg-[#1e1e1e] text-blue-300 font-mono text-sm overflow-x-auto">
                      <pre className="whitespace-pre-wrap">{content.sqlQuery}</pre>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Query Results Panel (Conditional) */}
          {showResults && (
            <div className="h-64 border-t border-slate-200 bg-white flex flex-col animate-in slide-in-from-bottom-10 duration-300">
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Resultados de la consulta</h4>
                <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-100">Success (0.12s)</span>
              </div>
              <div className="overflow-auto flex-1 p-0">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10">
                    <tr>
                      <th className="px-6 py-3 font-medium border-b">ID</th>
                      <th className="px-6 py-3 font-medium border-b">Customer</th>
                      <th className="px-6 py-3 font-medium border-b">Invoice Date</th>
                      <th className="px-6 py-3 font-medium border-b">Amount</th>
                      <th className="px-6 py-3 font-medium border-b">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[101, 102, 103, 104].map(id => (
                      <tr key={id} className="hover:bg-slate-50">
                        <td className="px-6 py-3 font-mono text-slate-600">INV-{id}</td>
                        <td className="px-6 py-3">Acme Corp Ltd.</td>
                        <td className="px-6 py-3 text-slate-500">2024-02-2{id-100}</td>
                        <td className="px-6 py-3 font-medium text-slate-700">${(id * 150.50).toFixed(2)}</td>
                        <td className="px-6 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${id % 2 === 0 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                            {id % 2 === 0 ? 'PAID' : 'PENDING'}
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
            <form onSubmit={handleSend} className="relative">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Escribe tu requerimiento (ej: 'Dame el total de ventas de la última semana')..."
                disabled={isLoading}
                className="w-full bg-slate-50 text-slate-900 placeholder-slate-400 border border-slate-300 rounded-xl py-4 pl-5 pr-14 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm transition-all"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || isLoading}
                className="absolute right-2 top-2 bottom-2 aspect-square bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            </form>
            <div className="text-center mt-2 text-[10px] text-slate-400">
              Nota: Esta es una aplicación frontend. La ejecución de SQL es simulada.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;