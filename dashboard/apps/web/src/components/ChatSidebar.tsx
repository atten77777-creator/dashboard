import React, { useEffect, useMemo, useRef, useState } from 'react';
// Removed conversationStore and conversationSession to make chat stateless
import { useApp } from '../context/AppContext';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { LLMConfigModal } from './LLMConfigModal';
import { Modal } from './Modal';
import { API_BASE, ensureApiBase } from '../api';
import { ChartRenderer } from './ChartRenderer';
import FullDataModal from './FullDataModal';
import ChartBuilderModal from './ChartBuilderModal';
import { buildChartSuggestions, suggestionAccent, SuggestedChart } from '../chart-suggestions';
import { PassphraseModal } from './PassphraseModal';
import { DashboardPickerModal } from './DashboardPickerModal';
import { addConversation, deleteConversation, loadHistory, saveHistory, saveHistoryReliable, setLastActive, updateConversation, getClientId, type Conversation, type ConversationHistory } from '../lib/conversationStore';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  // The exact SQL that was executed (may differ from displayed sql)
  executedSql?: string;
  result?: { rows: any[]; columns?: string[] } | { error: string } | null;
  status?: 'sending' | 'sent';
  extractedSql?: string[];
  showExtracted?: boolean;
  multiResults?: Array<{ rows: any[]; columns?: string[] } | { error: string } | null>;
  // Per-extracted query executed SQL tracking
  multiExecutedSql?: string[];
  aiSuggestions?: SuggestedChart[];
  multiAISuggestions?: Array<SuggestedChart[] | null>;
  tablesContext?: string[];
  aiError?: string;
  multiAIError?: string[];
  ts?: number;
  id?: string;
  // UI: hide SQL blocks when the user’s intent is visualization-only
  hideSql?: boolean;
  // Debugging: request/response trace from the LLM call
  debugTrace?: {
    provider?: string;
    model?: string;
    request?: {
      endpoint?: string;
      messages?: Array<{ role: string; content: string }>;
    };
    response?: { text?: string };
  };
  // UI: toggle to show/hide the trace panel per assistant message
  showTrace?: boolean;
  // Inline chart generation fields
  chartRequested?: boolean;
  chartTags?: { type?: string; x?: string; y?: string[]; extras?: Record<string, string> };
  // Per-query chart tags aligned with extracted SQL blocks
  multiChartTags?: Array<Array<{ type?: string; x?: string; y?: string[]; extras?: Record<string, string> }> | null>;
  inlineChart?: { title: string; type: string; config: any } | null;
  multiInlineChart?: Array<Array<{ title: string; type: string; config: any }> | null>;
}

interface TableInfo {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    is_primary_key: number;
    is_foreign_key: number;
  }>;
}

export function ChatSidebar() {
  const { isChatOpen, closeChat, openChat, activeDashboardId, loadDashboards, dashboards } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Dashboard Picker State
  const [dashboardPicker, setDashboardPicker] = useState<{ isOpen: boolean; type: 'all' | 'inline' | 'suggestion' | 'multiInline'; args: any[] }>({ isOpen: false, type: 'all', args: [] });
  // Store optional per-message SQL execution results
  const [loading, setLoading] = useState(false);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [schemaVersion, setSchemaVersion] = useState<number>(0);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [failedTables, setFailedTables] = useState<string[]>([]);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [llmType, setLLMType] = useState<'openai' | 'gemini' | 'azure' | 'openai_compatible' | 'anthropic' | 'ollama'>('openai');
  const [llmConnected, setLLMConnected] = useState<boolean>(false);
  const [llmConfigured, setLLMConfigured] = useState<boolean>(false);
  const [availableLLMs, setAvailableLLMs] = useState<string[]>([]);
  const [statusLoading, setStatusLoading] = useState<boolean>(false);
  const [tableFilter, setTableFilter] = useState('');
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [isTablesOpen, setIsTablesOpen] = useState(false);
  // Analysis suggestions toggle (default: on)
  const [analysisEnabled, setAnalysisEnabled] = useState<boolean>(true);
  // History dropdown state
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSchemaOpen, setIsSchemaOpen] = useState(false);
  const [newConvEffect, setNewConvEffect] = useState(false);
  // Delete confirmation state
  const [deleteConfirmation, setDeleteConfirmation] = useState<string | null>(null);
  const prevHistoryLen = useRef(0);

  // Full Data modal
  const [fullDataOpen, setFullDataOpen] = useState(false);
  const [fullDataSql, setFullDataSql] = useState('');
  // Chart Builder modal (inline from result previews)
  const [chartBuilderOpen, setChartBuilderOpen] = useState(false);
  const [chartBuilderData, setChartBuilderData] = useState<{ columns: (string | { name: string })[]; rows: any[] } | null>(null);
  // Removed AI Visualization modal/state
  // Saving state for per-chart add-to-dashboard actions
  const [savingSingle, setSavingSingle] = useState<Record<number, boolean>>({});
  const [savingSuggestion, setSavingSuggestion] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<Record<string, string>>({});
  const [conversationId, setConversationId] = useState<string | null>(null);
  const activeConvRef = useRef<string | null>(null);
  // Batch add state per message index
  const [savingBatch, setSavingBatch] = useState<Record<number, boolean>>({});
  const [batchError, setBatchError] = useState<Record<number, string>>({});
  const [persona, setPersona] = useState<string>('default');
  const [exporting, setExporting] = useState<boolean>(false);
  const [history, setHistory] = useState<ConversationHistory>({ version: 1, conversations: [], lastActiveId: undefined, encrypted: false });
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState<string | null>(null);
  const [isPassphraseOpen, setIsPassphraseOpen] = useState<boolean>(false);

  // Removed conversation banners, encryption/cloud sync, and history state for stateless chat
  // Detailed schema returned from server for selected tables
  interface SchemaColumnMetadata {
    column_name: string;
    data_type: string;
    nullable: string;
    is_primary_key: number;
    is_foreign_key: number;
    referenced_owner?: string;
    referenced_table?: string;
    referenced_column?: string;
  }
  interface SchemaTableMeta {
    name: string;
    columns: SchemaColumnMetadata[];
    relationships?: {
      foreignKeys: Array<{ column: string; referencedTable: string; referencedColumn: string }>;
      referencedBy: Array<{ table: string; column: string; referencedColumn: string }>;
    };
  }
  const [schemaTables, setSchemaTables] = useState<SchemaTableMeta[]>([]);
  // Track latest schema request to avoid stale updates without aborting fetches
  const schemaReqIdRef = useRef<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Removed: singleResultEndRefs since we no longer render a separate single SQL block
  const multiResultEndRefs = useRef<HTMLDivElement[]>([]);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const pendingUserIndexRef = useRef<number | null>(null);
  // Track previous message count to limit auto-scroll to appends only
  const prevMsgLenRef = useRef<number>(0);
  const [preview, setPreview] = useState<{ sql: string; index: number | null; qIndex?: number; mode?: 'single' | 'extracted' } | null>(null);

  // URL helpers to make each conversation its own page
  const getConversationIdFromURL = (): string | null => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get('conversation');
    } catch { return null; }
  };
  const buildConversationURL = (id: string): string => {
    try {
      const u = new URL(window.location.origin + window.location.pathname);
      u.searchParams.set('conversation', id);
      return u.toString();
    } catch {
      return `${window.location.origin}${window.location.pathname}?conversation=${encodeURIComponent(id)}`;
    }
  };
  // Track AI Fix progress per message/query index
  const [aiFixing, setAiFixing] = useState<Record<string, boolean>>({});
  // Context Viewer completely removed
  // Bind variables prompt removed

  // Map server DbMessage rows to UI ChatMessage, enforcing per-conversation filtering
  const normalizeServerMessages = (rows: any[], expectedConversationId?: string): ChatMessage[] => {
    if (!Array.isArray(rows)) return [];
    // Defensive filter: only rows that belong to the expected conversation (if provided)
    const filtered = rows
      .filter(r => r && (r.role === 'user' || r.role === 'assistant'))
      .filter(r => {
        if (!expectedConversationId) return true;
        const rid = String((r.conversationId ?? r.conversation_id ?? '') || '');
        return rid === expectedConversationId;
      });
    // Validation: ensure no messages from other conversations remain
    const mismatched = filtered.filter(r => {
      const rid = String((r.conversationId ?? r.conversation_id ?? '') || '');
      return expectedConversationId && rid && rid !== expectedConversationId;
    });
    if (mismatched.length) {
      console.warn('Filtered out messages from other conversations:', mismatched.length);
    }
    // Ensure stable ordering by createdAt ascending
    filtered.sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return at - bt;
    });
    const mapped: ChatMessage[] = filtered
      .map(r => {
        const raw = typeof r.content === 'string' ? r.content : String(r.content ?? '');
        const content = extractNarrativeText(normalizeLLMResponse(raw));
        // Recompute extracted SQL from stored assistant content on reload
        let extracted: string[] = [];
        try {
          const fromTags = extractAllSQL(raw);
          if (Array.isArray(fromTags) && fromTags.length) {
            extracted = fromTags.map(q => normalizeSQL(q));
          } else {
            const { sql } = extractSQLAndText(raw);
            if (sql && isLikelySQL(sql)) extracted = [normalizeSQL(sql)];
          }
          // Deduplicate by canonical form
          const seen = new Set<string>();
          extracted = extracted.filter(q => {
            const k = canonicalizeSQL(q);
            if (!k || seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        } catch { }
        const showExtracted = extracted.length > 0;

        const base: ChatMessage = {
          role: r.role === 'assistant' ? 'assistant' : 'user',
          content,
          status: 'sent',
          ts: (r.createdAt ? new Date(r.createdAt).getTime() : Date.now()),
          id: (typeof r.id === 'string' && r.id) ? r.id : uuidv4(),
        };

        let debugTrace: any = undefined;
        if (r.trace) {
          try {
            debugTrace = typeof r.trace === 'string' ? JSON.parse(r.trace) : r.trace;
          } catch { debugTrace = r.trace; }
        }

        return r.role === 'assistant'
          ? { ...base, extractedSql: showExtracted ? extracted : undefined, showExtracted: showExtracted ? true : undefined, multiResults: showExtracted ? [] : undefined, debugTrace }
          : base;
      });
    // Remove consecutive duplicate messages (same role + same normalized content)
    const out: ChatMessage[] = [];
    let prevKey = '';
    for (const m of mapped) {
      const key = `${m.role}|${String(m.content || '').trim()}`;
      if (key === prevKey) continue;
      out.push(m);
      prevKey = key;
    }
    return out;
  };

  // --- Persistent multi-conversation history (encryption removed; one-time migration supported) ---
  useEffect(() => {
    const restore = async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        // Resolve backend base before any server fetches to prevent connection errors
        await ensureApiBase();
        // Migration from old single-conversation key
        const OLD_KEY = 'trae2.chat.state.v1';
        const oldRaw = localStorage.getItem(OLD_KEY);
        const hasNew = localStorage.getItem('trae2.chat.history.v1') || localStorage.getItem('trae2.chat.history.enc');
        if (oldRaw && !hasNew) {
          try {
            const old = JSON.parse(oldRaw);
            const recoveredConv: Conversation = {
              id: 'c_recovered',
              title: 'Recovered Conversation',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messages: Array.isArray(old?.messages) ? old.messages : [],
            };
            const migrated: ConversationHistory = { version: 1, conversations: [recoveredConv], lastActiveId: recoveredConv.id, encrypted: false };
            await saveHistory(migrated, null);
            try { localStorage.removeItem(OLD_KEY); } catch { }
          } catch { }
        }

        const res = await loadHistory(passphrase);
        if (res.needsPassphrase) {
          // Encrypted history exists; prompt for passphrase to migrate to plaintext
          setHistoryLoading(false);
          setHistoryError(null);
          setIsPassphraseOpen(true);
          return;
        }
        if (res.error) {
          setHistoryError(res.error);
          setHistoryLoading(false);
          return;
        }
        let data = res.data!;
        // If we loaded encrypted history using a passphrase, immediately migrate to plaintext
        if (passphrase && res.encrypted) {
          try {
            await saveHistory({ ...data, encrypted: false }, null);
            data = { ...data, encrypted: false };
          } catch (e) {
            // Non-fatal; proceed with in-memory state
          } finally {
            // Clear passphrase so future saves remain plaintext
            setPassphrase(null);
          }
        }
        // Try restoring server-side conversations; if present, prefer them
        try {
          await ensureApiBase();
          const sres = await fetch(`${API_BASE}/state/conversations`, { headers: { 'x-client-id': getClientId() } });
          if (sres.ok) {
            const sj = await sres.json();
            if (sj?.conversations?.conversations && Array.isArray(sj.conversations.conversations)) {
              const persisted = sj.conversations;
              data = {
                version: 1,
                encrypted: false,
                conversations: Array.isArray(persisted.conversations) ? persisted.conversations : [],
                lastActiveId: persisted.lastActiveId || data.lastActiveId,
              } as ConversationHistory;
            }
          }
        } catch { }
        setHistory({ ...data, encrypted: false });
        // Restore active conversation, preferring URL param so each conversation opens on its own page
        const urlConvId = getConversationIdFromURL();
        const activeId = urlConvId || data.lastActiveId || data.conversations[0]?.id || null;
        setConversationId(activeId);
        activeConvRef.current = activeId || null;
        const active = data.conversations.find(c => c.id === activeId);
        const msgs = active?.messages || [];
        // Ensure only messages from the active conversation are shown
        setMessages(normalizeServerMessages(Array.isArray(msgs) ? msgs : [], activeId || undefined));
        // Attempt server recovery of messages for the active conversation, if available
        try {
          if (activeId) {
            await ensureApiBase();
            const mres = await fetch(`${API_BASE}/state/conversations/${activeId}/messages?limit=500`, { headers: { 'x-client-id': getClientId() } });
            if (mres.ok) {
              const mj = await mres.json();
              if (Array.isArray(mj?.messages)) {
                setMessages(normalizeServerMessages(mj.messages, activeId));
              }
            }
          }
        } catch { }
        // Auto-open chat when a conversation is specified via URL, even if it has no messages yet
        if (!isChatOpen && (urlConvId || msgs.length > 0)) openChat();
      } catch (e: any) {
        setHistoryError(String(e?.message || e));
      } finally {
        setHistoryLoading(false);
      }
    };
    void restore();
  }, [passphrase]);

  // Encryption flow removed: once decrypted, history is stored plaintext going forward

  // Save history whenever the active conversation changes messages
  // Prevent concurrent create/delete operations to keep UI and server in sync
  const [creatingConv, setCreatingConv] = useState<boolean>(false);
  const [deletingConvId, setDeletingConvId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  useEffect(() => {
    const persist = async () => {
      try {
        if (!conversationId) return;
        setSaveStatus('saving');
        const updated = updateConversation(history, conversationId, (c) => ({ ...c, messages }));
        updated.lastActiveId = conversationId;
        updated.encrypted = false;
        updated.conversations = updated.conversations.map(c => c.id === conversationId ? { ...c, updatedAt: Date.now() } : c);
        setHistory(updated);
        await saveHistoryReliable(updated, null);
        try {
          await ensureApiBase();
          await fetch(`${API_BASE}/state/conversations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-client-id': getClientId() },
            body: JSON.stringify({ version: 1, lastActiveId: updated.lastActiveId, conversations: updated.conversations })
          });
          setSaveStatus('saved');
          // Clear the visual indicator after a short delay
          setTimeout(() => setSaveStatus('idle'), 1500);
        } catch {
          setSaveStatus('error');
        }
      } catch (e) {
        // Ignore transient save errors
        setSaveStatus('error');
      }
    };
    void persist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Effect to trigger animation when a new conversation is added
  useEffect(() => {
    if (!deletingConvId && history.conversations.length > prevHistoryLen.current && prevHistoryLen.current !== 0) {
      setNewConvEffect(true);
      const t = setTimeout(() => setNewConvEffect(false), 2000);
      return () => clearTimeout(t);
    }
    prevHistoryLen.current = history.conversations.length;
  }, [history.conversations.length, deletingConvId]);

  // Cloud backup with a stable client id and light retries
  useEffect(() => {
    const syncToCloud = async () => {
      try {
        await ensureApiBase();
        const clientId = getClientId();
        if (!history || !history.conversations) return;
        const payload = { version: 1, lastActiveId: history.lastActiveId, conversations: history.conversations };
        const res = await fetch(`${API_BASE}/state/conversations`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-client-id': clientId }, body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Cloud backup failed');
      } catch {
        // retry once after brief delay
        setTimeout(async () => {
          try {
            await ensureApiBase();
            const clientId = getClientId();
            const payload = { version: 1, lastActiveId: history.lastActiveId, conversations: history.conversations };
            await fetch(`${API_BASE}/state/conversations`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'x-client-id': clientId }, body: JSON.stringify(payload)
            });
          } catch { }
        }, 300);
      }
    };
    // Trigger sync when conversation list changes structurally (title/updatedAt)
    syncToCloud();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history?.lastActiveId, history?.conversations.map(c => `${c.id}:${c.title}:${c.updatedAt}`).join('|')]);

  // Periodic integrity check: ping server and infer sync health
  useEffect(() => {
    const clientId = getClientId();
    const timer = setInterval(async () => {
      try {
        await ensureApiBase();
        const res = await fetch(`${API_BASE}/state/conversations`, { headers: { 'x-client-id': clientId } });
        if (res.ok) {
          if (saveStatus === 'error') setSaveStatus('idle');
        } else {
          setSaveStatus('error');
        }
      } catch {
        setSaveStatus('error');
      }
    }, 60000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Helpers: Extract and sanitize SQL from assistant responses ---
  const stripCodeFences = (s: string) => s
    // Remove language-tagged fences across SQL dialects
    .replace(/```\s*(sql|plsql|tsql|postgresql|mysql|sqlite|snowflake|redshift|bigquery|oracle|mssql)[\s\S]*?```/gi, (m) => m.replace(/```\s*(sql|plsql|tsql|postgresql|mysql|sqlite|snowflake|redshift|bigquery|oracle|mssql)|```/gi, ''))
    // Remove language-tagged tildes fences
    .replace(/~~~\s*(sql|plsql|tsql|postgresql|mysql|sqlite|snowflake|redshift|bigquery|oracle|mssql)[\s\S]*?~~~/gi, (m) => m.replace(/~~~\s*(sql|plsql|tsql|postgresql|mysql|sqlite|snowflake|redshift|bigquery|oracle|mssql)|~~~/gi, ''))
    // Remove generic fences
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
    // Remove generic tildes fences
    .replace(/~~~[\s\S]*?~~~/g, (m) => m.replace(/~~~/g, ''))
    .trim();

  // Remove leading non-SQL labels like "SQL:", "Query 1:", etc.
  const stripLeadingLabels = (s: string) => {
    const lines = String(s || '').split(/\r?\n/);
    while (lines.length) {
      const first = lines[0].trim();
      if (/^(sql|query|statement|example|snippet)\s*\d*\s*:.*$/i.test(first)) {
        lines.shift();
        continue;
      }
      break;
    }
    return lines.join('\n');
  };

  const isLikelySQL = (s: string) => {
    // Robustly remove all leading comments and labels before keyword detection
    let t = String(s || '');
    // Strip any number of leading block comments
    t = t.replace(/^(\s*\/\*[\s\S]*?\*\/\s*)+/m, '');
    // Strip any number of leading line comments
    t = t.replace(/^(\s*--[^\n]*(\r?\n))+/, '');
    // Remove common leading labels (e.g., "SQL:", "Query 1:")
    t = stripLeadingLabels(t).trim().toUpperCase();
    // Tolerate bullet/number prefixes before the SQL keyword
    t = t.replace(/^(?:[-*•]\s+|\d+\.\s+|\(\d+\)\s+|[A-Z]\)\s+)+/, '');
    // Strict Oracle DML/DDL starts only; exclude narrative "ANALYZE ..." and partial EXPLAIN
    return /^(SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|MERGE|TRUNCATE)\b/.test(t);
  };

  const normalizeSQL = (sql: string) => {
    // Preserve AI-provided SQL verbatim; only strip code fences and a leading 'SQL:' label
    let s = String(sql || '');
    s = stripCodeFences(s);
    s = s.replace(/^SQL\s*:\s*/i, '');
    s = stripLeadingLabels(s);
    return s.trim();
  };

  // Canonical form for dedupe (not for display or execution)
  const canonicalizeSQL = (sql: string) => {
    let s = String(sql || '');
    s = stripCodeFences(s);
    // Remove ALL block and line comments for dedup purposes
    s = s.replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)--[^\n]*(\r?\n)?/g, '$1');
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/;\s*$/, '');
    return s;
  };

  // Lightweight validation to check if SQL appears executable


  const extractSQLAndText = (response: string, sqlFromServer?: string) => {
    // Prefer server-provided sqlQuery when available, but validate it's actually SQL
    const sqlCandidate = sqlFromServer ? normalizeSQL(sqlFromServer) : null;
    let sql: string | null = (sqlCandidate && isLikelySQL(sqlCandidate)) ? sqlCandidate : null;
    let text = response || '';

    // If sql is not provided, try to find it inside the response
    if (!sql) {
      const fenced = response.match(/```sql([\s\S]*?)```/i)
        || response.match(/```([\s\S]*?)```/)
        || response.match(/~~~sql([\s\S]*?)~~~/i)
        || response.match(/~~~([\s\S]*?)~~~/);
      if (fenced && fenced[1]) {
        const candidate = normalizeSQL(fenced[1]);
        if (isLikelySQL(candidate)) sql = candidate;
      } else {
        // HTML code/pre blocks
        const htmlCode = response.match(/<code[^>]*>([\s\S]*?)<\/code>/i)
          || response.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
        if (htmlCode && htmlCode[1]) {
          const raw = String(htmlCode[1] || '').replace(/<[^>]*>/g, '');
          const candidate = normalizeSQL(raw);
          if (isLikelySQL(candidate)) sql = candidate;
        }
        if (!sql) {
          // Try first block starting with SQL keywords
          const lines = response.split(/\r?\n/);
          const startIdx = lines.findIndex(l => isLikelySQL(l));
          if (startIdx >= 0) {
            const buf: string[] = [];
            for (let i = startIdx; i < lines.length; i++) {
              const line = lines[i];
              if (/^\s*$/.test(line)) break; // stop at blank line
              buf.push(line);
              if (/;\s*$/.test(line)) break; // stop after semicolon
            }
            const candidate = normalizeSQL(buf.join('\n'));
            if (isLikelySQL(candidate)) sql = candidate;
          }
        }
      }
    }

    // Remove any fenced code from text to keep non-SQL content above
    if (text) {
      text = text
        .replace(/```sql[\s\S]*?```/gi, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/~~~sql[\s\S]*?~~~/gi, '')
        .replace(/~~~[\s\S]*?~~~/g, '')
        .replace(/<code[\s\S]*?<\/code>/gi, '')
        .replace(/<pre[\s\S]*?<\/pre>/gi, '')
        .trim();
    }

    return { sql, text };
  };

  // Extract narrative text strictly between <text>...</text> tags
  const extractTextBlocks = (response: string): string[] => {
    const text = String(response || '');
    const re = /<text>([\s\S]*?)<\/text>/gi;
    const matches = Array.from(text.matchAll(re)).map(m => String(m[1] || '').trim());
    return matches.filter(Boolean);
  };

  // Prefer <text> blocks; fallback to response with SQL/code stripped
  const extractNarrativeText = (response: string): string => {
    let s = String(response || '');
    const blocks = extractTextBlocks(s);
    if (blocks.length) {
      // Show only the <text> content and keep it concise
      return briefenText(blocks.join('\n\n').trim());
    }
    // Fallback: remove any <sql> tags and fenced code
    s = s.replace(/<sql\s*start>[\s\S]*?<\/?sql\s*end>/gi, '');
    s = s.replace(/```[\s\S]*?```/g, '');
    s = s.replace(/~~~[\s\S]*?~~~/g, '');
    // Also strip HTML code/pre blocks to avoid clutter
    s = s.replace(/<code[\s\S]*?<\/code>/gi, '');
    s = s.replace(/<pre[\s\S]*?<\/pre>/gi, '');
    return briefenText(s.trim());
  };

  // Detect boilerplate assistant text that merely announces an SQL query


  // Detect when the user explicitly requests multiple SQL statements or a full script




  // Compute a dynamic chart limit based on dataset richness
  // - More columns => more charts to cover different perspectives
  // - Few rows => cap to avoid overplotting sparse data
  // - Always respect available suggestion count
  function recommendedChartLimit(colsRaw: any[] | undefined, rowsRaw: any[] | undefined, maxAvailable: number): number {
    const colsLen = Array.isArray(colsRaw) ? colsRaw.length : 0;
    const rowsLen = Array.isArray(rowsRaw) ? rowsRaw.length : 0;
    let base = 1;
    if (colsLen <= 3) base = 2;
    else if (colsLen <= 6) base = 4;
    else if (colsLen <= 10) base = 6;
    else if (colsLen <= 20) base = 8;
    else base = 10;
    if (rowsLen > 0) {
      if (rowsLen < 15) base = Math.min(base, 3);
      else if (rowsLen < 50) base = Math.min(base, 6);
      else if (rowsLen < 500) base = Math.min(base, 9);
    }
    return Math.max(1, Math.min(base, Math.max(1, maxAvailable)));
  }

  // Identify explicit table mentions and column references in the prompt








  // Extract SQL queries only between <sql start> and <sql end> tags; also include server-provided SQL if any
  const extractAllSQL = (response: string, sqlFromServer?: string, deduplicate = true) => {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (q: string) => {
      const n = normalizeSQL(String(q || '')).trim();
      const key = canonicalizeSQL(n);
      if (n && key && (!deduplicate || !seen.has(key))) { 
        if (deduplicate) seen.add(key); 
        out.push(n); 
      }
    };
    const text = String(response || '');
    const re = /<sql\s*start>([\s\S]*?)<\/?sql\s*end>/gi;
    const matches = Array.from(text.matchAll(re));
    for (const m of matches) { push(m[1] || ''); }
    
    // Always check for duplicates against the extracted list for sqlFromServer, regardless of deduplicate flag
    if (typeof sqlFromServer === 'string' && sqlFromServer.trim()) {
      const n = normalizeSQL(String(sqlFromServer)).trim();
      const key = canonicalizeSQL(n);
      // Check if this exact query (canonicalized) is already in the output
      const alreadyExists = out.some(existing => canonicalizeSQL(existing) === key);
      if (!alreadyExists) {
        out.push(n);
      }
    }
    return out;
  };

  // Context summary removed along with Context Viewer

  // Detect explicit chart intent in user text and infer a type if mentioned
  function detectChartIntent(input: string): { requested: boolean; type?: string } {
    const s = String(input || '').toLowerCase();
    const requested = /(chart|graph|plot|visuali[sz]e|visualization|trend|scatter|bar|column|line|area|pie|donut|histogram|radar|heatmap|treemap|gauge|funnel|candlestick)/.test(s);
    let type: string | undefined;
    const typeMatchers: Array<{ re: RegExp; t: string }> = [
      { re: /stacked\s*(bar|column)/, t: 'stackedBar' },
      { re: /stacked\s*area/, t: 'stackedArea' },
      { re: /(bar|column)\s*chart|\bbar\b|\bcolumn\b/, t: 'bar' },
      { re: /line\s*chart|\bline\b|\btrend\b/, t: 'line' },
      { re: /area\s*chart|\barea\b/, t: 'area' },
      { re: /pie\s*chart|\bdonut\b|\bpie\b/, t: 'pie' },
      { re: /scatter|bubble/, t: 'scatter' },
      { re: /histogram|distribution/, t: 'histogram' },
      { re: /radar/, t: 'radar' },
      { re: /heatmap/, t: 'heatmap' },
      { re: /treemap/, t: 'treemap' },
      { re: /gauge/, t: 'gauge' },
      { re: /funnel/, t: 'funnel' },
      { re: /candlestick|ohlc/, t: 'candlestick' },
    ];
    for (const m of typeMatchers) {
      if (m.re.test(s)) { type = m.t; break; }
    }
    return { requested, type };
  }

  // Canonicalize chart type names from LLM tags to system-supported types
  function canonicalizeChartType(raw?: string): string | undefined {
    if (!raw) return undefined;
    const s = String(raw).trim().toLowerCase();
    const candidates: Array<{ re: RegExp; t: string }> = [
      { re: /^(bar|bars?|bar\s*chart|horizontal\s*bar|hbar)$/i, t: 'bar' },
      { re: /^(column|columns?|column\s*chart|vertical\s*bar|vbar)$/i, t: 'column' },
      { re: /^(line|line\s*chart|trend|trend\s*line)$/i, t: 'line' },
      { re: /^(area|area\s*chart)$/i, t: 'area' },
      { re: /^(pie|pie\s*chart)$/i, t: 'pie' },
      { re: /^(donut|doughnut)$/i, t: 'donut' },
      { re: /^(scatter|scatter\s*plot|scatterplot)$/i, t: 'scatter' },
      { re: /^(bubble|bubble\s*chart)$/i, t: 'bubble' },
      { re: /^(hist|histogram|distribution)$/i, t: 'histogram' },
      { re: /^(radar|spider|spiderweb)$/i, t: 'radar' },
      { re: /^(heatmap|heat\s*map)$/i, t: 'heatmap' },
      { re: /^(treemap|tree\s*map)$/i, t: 'treemap' },
      { re: /^(gauge|dial|speedometer)$/i, t: 'gauge' },
      { re: /^(funnel|pyramid)$/i, t: 'funnel' },
      { re: /^(stacked\s*bar|stacked\s*column)$/i, t: 'stackedBar' },
      { re: /^(stacked\s*area)$/i, t: 'stackedArea' },
      { re: /^(candlestick|ohlc)$/i, t: 'candlestick' },
      { re: /^(table|grid|data\s*table|tabular)$/i, t: 'table' },
      { re: /^(number|metric|kpi)$/i, t: 'number' },
    ];
    for (const m of candidates) {
      if (m.re.test(s)) return m.t;
    }
    return s || undefined;
  }

  // Parse simple chart metadata tags from the LLM response
  function parseChartTags(raw: string): { type?: string; x?: string; y?: string[]; extras?: Record<string, string> } | null {
    const s = String(raw || '');
    const tag = (name: string, multiple = false): string[] => {
      const re = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'gi');
      const matches = Array.from(s.matchAll(re)).map(m => String(m[1] || '').trim()).filter(Boolean);
      return multiple ? matches : (matches.length ? [matches[0]] : []);
    };
    const altTag = (names: string[], multiple = false): string[] => {
      for (const n of names) {
        const vals = tag(n, multiple);
        if (vals.length) return vals;
      }
      return [];
    };
    const typeRaw = altTag(['chart', 'type'])[0];
    const type = canonicalizeChartType(typeRaw);
    const x = (altTag(['xaxis', 'x'])[0] || undefined);
    const yVals = altTag(['yaxis', 'y'], true);
    const extras: Record<string, string> = {};
    const extraNames = [
      'title', 'yagg', 'yAgg', 'palette', 'legend', 'datazoom',
      'numberPrefix', 'numberSuffix', 'numberFontSize',
      // pie / donut extras
      'pieLabelMode', 'donutThickness', 'rotationAngle', 'sliceExplode', 'topN', 'labelOn', 'legendPosition', 'legendOrient', 'legendCompact', 'minLabelPercent', 'pieSort',
      // gauge extras
      'gaugeMin', 'gaugeMax', 'gaugeTarget', 'gaugeArcThickness', 'gaugeSemi'
    ];
    for (const nm of extraNames) {
      const v = tag(nm)[0];
      if (v) extras[nm] = v;
    }
    if (!type && !x && !yVals.length) return null;
    return { type, x, y: yVals.length ? yVals : undefined, extras: Object.keys(extras).length ? extras : undefined };
  }

  // Extract per-query chart tags by associating tags nearest to each <sql> block (after or before)
  function extractMultiChartTags(raw: string): Array<Array<{ type?: string; x?: string; y?: string[]; extras?: Record<string, string> }> | null> {
    const s = String(raw || '');
    const blocks: Array<{ start: number; end: number }> = [];
    const re = /<sql\s*start>([\s\S]*?)<\/?sql\s*end>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      blocks.push({ start: m.index, end: re.lastIndex });
    }
    if (!blocks.length) return [];

    // Local parser that finds ALL chart tags within a segment
    const parseSegmentTags = (seg: string): Array<{ type?: string; x?: string; y?: string[]; extras?: Record<string, string> }> => {
      const text = String(seg || '');
      const grab = (name: string): string[] => {
        const rgx = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'gi');
        const matches = Array.from(text.matchAll(rgx)).map(mm => String(mm[1] || '').trim()).filter(Boolean);
        return matches;
      };
      
      const typesRaw = grab('chart');
      const xs = grab('xaxis');
      const ys = grab('yaxis');
      
      if (!typesRaw.length && !xs.length && !ys.length) return [];

      const extraNames = [
        'title', 'yagg', 'yAgg', 'palette', 'legend', 'datazoom',
        'numberPrefix', 'numberSuffix', 'numberFontSize',
        'pieLabelMode', 'donutThickness', 'rotationAngle', 'sliceExplode', 'topN', 'labelOn', 'legendPosition', 'legendOrient', 'legendCompact', 'minLabelPercent', 'pieSort',
        'gaugeMin', 'gaugeMax', 'gaugeTarget', 'gaugeArcThickness', 'gaugeSemi'
      ];

      // DETECT MULTIPLE CHARTS vs SINGLE CHART MULTI-SERIES
      // If multiple <chart> tags are present, we treat it as multiple charts.
      // If only 1 (or 0) <chart> tag is present, but multiple <yaxis>, we treat it as a single chart with multiple series.
      const isMultiChart = typesRaw.length > 1;

      if (!isMultiChart) {
          // Single chart mode
          const type = canonicalizeChartType(typesRaw[0]);
          const x = xs[0]; // Take the first X
          const yVals = ys; // Take ALL Ys
          
          const extras: Record<string, string> = {};
          for (const nm of extraNames) {
             const vals = grab(nm);
             if (vals.length) extras[nm] = vals[0];
          }
          return [{ 
            type, 
            x: x || undefined, 
            y: yVals.length ? yVals : undefined, 
            extras: Object.keys(extras).length ? extras : undefined 
          }];
      }

      const count = Math.max(typesRaw.length, xs.length, ys.length);
      const results: Array<{ type?: string; x?: string; y?: string[]; extras?: Record<string, string> }> = [];
      
      for (let i = 0; i < count; i++) {
        const tRaw = typesRaw[i] || typesRaw[typesRaw.length - 1];
        const x = xs[i] || xs[xs.length - 1];
        const yVal = ys[i] || ys[ys.length - 1];
        const yVals = yVal ? [yVal] : undefined;
        
        const type = canonicalizeChartType(tRaw);
        
        const extras: Record<string, string> = {};
        for (const nm of extraNames) {
          const vals = grab(nm);
          if (vals.length) {
            extras[nm] = vals[i] || vals[vals.length - 1];
          }
        }
        
        results.push({ 
          type, 
          x: x || undefined, 
          y: yVals, 
          extras: Object.keys(extras).length ? extras : undefined 
        });
      }
      return results;
    };

    const out: Array<Array<{ type?: string; x?: string; y?: string[]; extras?: Record<string, string> }> | null> = [];
    for (let i = 0; i < blocks.length; i++) {
      const afterFrom = blocks[i].end;
      const afterTo = i < blocks.length - 1 ? blocks[i + 1].start : s.length;
      const afterSeg = s.slice(afterFrom, afterTo);
      let tags = parseSegmentTags(afterSeg);
      
      if (!tags.length) {
        const beforeFrom = i > 0 ? blocks[i - 1].end : 0;
        const beforeTo = blocks[i].start;
        const beforeSeg = s.slice(beforeFrom, beforeTo);
        tags = parseSegmentTags(beforeSeg);
      }
      out.push(tags.length ? tags : null);
    }
    // Single-query fallback: if only one SQL block and no per-block tags found, use global tags
    if (blocks.length === 1 && !out[0]) {
      const globalTags = parseChartTags(s);
      if (globalTags) out[0] = [globalTags];
    }
    return out;
  }

  // Build a lightweight inline chart config from SQL results and parsed tags
  function makeInlineChartFromData(data: any, chartTags?: { type?: string; x?: string; y?: string[]; extras?: Record<string, string> }, sourceSql?: string): { chart?: { title: string; type: string; config: any }; error?: string } {
    if (!data || (Array.isArray(data.rows) ? data.rows.length === 0 : true)) {
      return { error: 'No data to visualize' };
    }
    // Normalize columns to { name, type }
    const cols: Array<{ name: string; type?: string }> = Array.isArray(data.columns) && data.columns.length
      ? (typeof data.columns[0] === 'string' ? (data.columns as string[]).map(n => ({ name: n })) : (data.columns as Array<{ name: string; type?: string }>))
      : (Object.keys(data.rows[0] || {}).map(n => ({ name: n })));
    const colNames = cols.map(c => c.name);
    const sampleRows: any[] = (data.rows || []).slice(0, 50);
    const colIsNumeric = (name: string): boolean => {
      let numeric = 0, total = 0;
      for (const r of sampleRows) {
        const v = r?.[name];
        if (v === null || typeof v === 'undefined') continue;
        total++;
        if (typeof v === 'number') numeric++;
        else if (typeof v === 'string') {
          const p = parseFloat(v);
          if (Number.isFinite(p)) numeric++;
        }
      }
      return total > 0 && (numeric / total) > 0.6;
    };
    const dims = colNames.filter(n => !colIsNumeric(n));
    const measures = colNames.filter(n => colIsNumeric(n));

    // Helper: normalize SQL expressions for loose matching
    const normalizeExpr = (s?: string) => {
      if (!s) return '';
      return String(s).replace(/"|\'|\`/g, '').replace(/\s+/g, '').toLowerCase();
    };
    // Helper: parse SELECT clause and build expression -> alias map
    const buildSelectAliasMap = (sql?: string): Record<string, string> => {
      if (!sql || typeof sql !== 'string') return {};
      const upper = sql.toUpperCase();
      const iSel = upper.indexOf('SELECT');
      const iFrom = upper.indexOf('FROM');
      if (iSel === -1 || iFrom === -1 || iFrom <= iSel) return {};
      const selectBody = sql.substring(iSel + 6, iFrom);
      const items: string[] = [];
      let cur = '';
      let depth = 0;
      let inSingle = false, inDouble = false, inBack = false;
      for (let i = 0; i < selectBody.length; i++) {
        const ch = selectBody[i];
        if (ch === "'" && !inDouble && !inBack) inSingle = !inSingle;
        else if (ch === '"' && !inSingle && !inBack) inDouble = !inDouble;
        else if (ch === '`' && !inSingle && !inDouble) inBack = !inBack;
        else if (ch === '(' && !inSingle && !inDouble && !inBack) depth++;
        else if (ch === ')' && !inSingle && !inDouble && !inBack) depth = Math.max(0, depth - 1);
        if (ch === ',' && depth === 0 && !inSingle && !inDouble && !inBack) {
          items.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      if (cur.trim()) items.push(cur.trim());
      const map: Record<string, string> = {};
      for (const raw of items) {
        // find AS alias (case-insensitive)
        const m = raw.match(/\s+AS\s+([a-zA-Z0-9_"'`]+)/i);
        if (m) {
          const alias = m[1].replace(/^["'`](.*)["'`]$/, '$1');
          const expr = raw.substring(0, m.index).trim();
          map[normalizeExpr(expr)] = alias;
        } else {
          // also support "expr alias" without AS
          const parts = raw.split(/\s+/).filter(Boolean);
          if (parts.length >= 2) {
            const alias = parts[parts.length - 1].replace(/^["'`](.*)["'`]$/, '$1');
            const expr = parts.slice(0, parts.length - 1).join(' ');
            map[normalizeExpr(expr)] = alias;
          }
        }
      }
      return map;
    };
    // Build a map of SELECT expressions -> aliases to help match computed fields
    const aliasMap: Record<string, string> = buildSelectAliasMap(sourceSql);
    const normalizeName = (s: string) => String(s).replace(/["'`]/g, '').replace(/\s+/g, '').replace(/[_\-]/g, '').toLowerCase();
    const resolveAxisToColumn = (tag?: string): string | undefined => {
      if (!tag) return undefined;
      // Exact match
      if (colNames.includes(tag)) return tag;
      // Case-insensitive match
      const ci = colNames.find(c => c.toLowerCase() === String(tag).toLowerCase());
      if (ci) return ci;
      // Normalized name match (strip quotes/underscores/spaces)
      const normTag = normalizeName(tag);
      const nc = colNames.find(c => normalizeName(c) === normTag);
      if (nc) return nc;
      // Match computed SELECT expressions via alias map
      const exprAlias = aliasMap[normalizeExpr(tag)];
      if (exprAlias && colNames.includes(exprAlias)) return exprAlias;
      return undefined;
    };

    // Determine type
    let type = chartTags?.type || 'bar';
    if (!chartTags?.type) {
      if (dims.length && measures.length) type = 'bar';
      else if (measures.length >= 2) type = 'scatter';
      else if (measures.length === 1) type = 'histogram';
      else type = 'bar';
    }
    // Normalize to system chart names
    type = canonicalizeChartType(type) || 'bar';

    // Determine fields with strict tag enforcement when axes are provided
    const tagsHaveAxes = !!(chartTags && (chartTags.x || (Array.isArray(chartTags.y) && chartTags.y.length)));
    let xField: string | undefined;
    let yField: string | undefined;
    let y2Field: string | undefined;

    if (tagsHaveAxes) {
      const typeRequiresX = !(['number', 'gauge', 'table'].includes(type));
      if (chartTags?.x) {
        const resolvedX = resolveAxisToColumn(chartTags.x);
        if (!resolvedX && typeRequiresX) {
          return { error: `X axis not in result columns: ${chartTags.x}` };
        }
        xField = resolvedX;
      } else if (typeRequiresX) {
        xField = dims[0] || colNames[0];
      }

      const ys = Array.isArray(chartTags?.y) ? chartTags!.y : [];
      const typeRequiresY = !(['table', 'number'].includes(type));
      if (ys.length) {
        const y1 = ys[0];
        const resolvedY1 = resolveAxisToColumn(y1);
        if (!resolvedY1 && typeRequiresY) {
          return { error: `Y axis not in result columns: ${y1}` };
        }
        yField = resolvedY1;
        if (ys.length > 1) {
          const y2 = ys[1];
          // if user specified yaxis 2 times, the second one is y2
          const resolvedY2 = resolveAxisToColumn(y2);
          if (!resolvedY2) {
            return { error: `Second Y axis not in result columns: ${y2}` };
          }
          if (resolvedY2 !== resolvedY1) {
             y2Field = resolvedY2;
          }
        }
      } else if (typeRequiresY) {
        yField = measures[0] || (colNames[1] || undefined);
      }
    } else {
      // Heuristic inference only when tags are absent
      xField = (dims[0] || colNames[0]);
      yField = measures[0] || (colNames[1] || undefined);
      if (type === 'histogram') {
        xField = measures[0] || xField;
        yField = measures[1] || yField;
      }
      if (!xField) return { error: 'Could not infer an X axis' };
      if (!yField && type !== 'histogram' && type !== 'pie' && type !== 'donut' && type !== 'gauge') {
        return { error: 'Could not infer a Y axis' };
      }
      // Do not infer Y2 when tags are absent; only include Y2 if provided
    }

    const config: any = {};
    if (typeof xField !== 'undefined') config.xField = xField;
    if (typeof yField !== 'undefined') config.yField = yField;
    if (typeof y2Field !== 'undefined') config.y2Field = y2Field;
    // Apply extras
    const extras = chartTags?.extras || {};
    if (extras.yagg || extras.yAgg) {
      const agg = String(extras.yagg || extras.yAgg).toLowerCase();
      if (['none', 'sum', 'avg', 'count', 'min', 'max'].includes(agg)) config.yAgg = agg;
    }
    if (extras.legend) config.showLegend = /true|on|yes|1/i.test(String(extras.legend));
    if (extras.datazoom) config.dataZoom = /true|on|yes|1/i.test(String(extras.datazoom));
    if (extras.labelOn) config.labelOn = /true|on|yes|1/i.test(String(extras.labelOn));
    if (extras.sliceExplode) config.sliceExplode = /true|on|yes|1/i.test(String(extras.sliceExplode));
    if (extras.numberPrefix) config.numberPrefix = String(extras.numberPrefix);
    if (extras.numberSuffix) config.numberSuffix = String(extras.numberSuffix);
    if (extras.numberFontSize) {
      const nfs = Number(extras.numberFontSize); if (Number.isFinite(nfs)) config.numberFontSize = nfs;
    }
    if (extras.legendPosition && /^(top|bottom|left|right)$/i.test(String(extras.legendPosition))) {
      config.legendPosition = String(extras.legendPosition).toLowerCase() as any;
    }
    if (extras.legendOrient && /^(horizontal|vertical)$/i.test(String(extras.legendOrient))) {
      config.legendOrient = String(extras.legendOrient).toLowerCase() as any;
    }
    if (extras.legendCompact) config.legendCompact = /true|on|yes|1/i.test(String(extras.legendCompact));
    // Pie / donut
    if (extras.pieLabelMode && /^(percent|value|category)$/i.test(String(extras.pieLabelMode))) {
      config.pieLabelMode = String(extras.pieLabelMode).toLowerCase() as any;
    }
    if (extras.donutThickness) { const dt = Number(extras.donutThickness); if (Number.isFinite(dt)) config.donutThickness = dt; }
    if (extras.rotationAngle) { const ra = Number(extras.rotationAngle); if (Number.isFinite(ra)) config.rotationAngle = ra; }
    if (extras.topN) { const tn = Number(extras.topN); if (Number.isFinite(tn)) config.topN = Math.max(1, Math.floor(tn)); }
    if (extras.minLabelPercent) { const mp = Number(extras.minLabelPercent); if (Number.isFinite(mp)) config.minLabelPercent = Math.max(0, Math.min(100, mp)); }
    if (extras.pieSort && /^(asc|desc|none)$/i.test(String(extras.pieSort))) { config.pieSort = String(extras.pieSort).toLowerCase() as any; }
    // Gauge
    if (extras.gaugeMin) { const gmin = Number(extras.gaugeMin); if (Number.isFinite(gmin)) config.gaugeMin = gmin; }
    if (extras.gaugeMax) { const gmax = Number(extras.gaugeMax); if (Number.isFinite(gmax)) config.gaugeMax = gmax; }
    if (extras.gaugeTarget) { const gt = Number(extras.gaugeTarget); if (Number.isFinite(gt)) config.gaugeTarget = gt; }
    if (extras.gaugeArcThickness) { const gth = Number(extras.gaugeArcThickness); if (Number.isFinite(gth)) config.gaugeArcThickness = gth; }
    if (extras.gaugeSemi) config.gaugeSemi = /true|on|yes|1/i.test(String(extras.gaugeSemi));

    // Reasonable defaults by type
    if (type === 'line') { config.smooth = true; config.lineWidth = 2; }
    if (type === 'area') { config.area = true; config.smooth = true; config.areaOpacity = 0.25; }
    if (type === 'stackedBar' || type === 'stackedArea') { config.stack = true; config.showLegend = true; }
    if (type === 'pie' || type === 'donut') { config.pieLabelMode = config.pieLabelMode || 'percent'; config.showLegend = config.showLegend ?? true; config.legendOrient = config.legendOrient || 'vertical'; }

    const title = extras.title || (
      (yField && xField) ? `${yField} by ${xField}` :
        (yField ? `${yField}` : (xField ? `${type} of ${xField}` : `${type}`))
    );
    return { chart: { title, type, config } };
  }

  // Targeted scroll helpers
  const scrollIntoViewRef = (el?: HTMLElement | null) => {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };

  const scrollToMultiResultsEnd = (msgIndex: number) => {
    const el = multiResultEndRefs.current[msgIndex];
    scrollIntoViewRef(el);
  };

  // Quick filter for table selection, with selected tables pinned to top (stable order)
  const filteredTables = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    const base = q
      ? tables.filter(t => (t.name || '').toLowerCase().includes(q))
      : tables;
    if (!selectedTables.length) return base;
    const indexMap = new Map<string, number>();
    tables.forEach((t, i) => indexMap.set(t.name, i));
    return base.slice().sort((a, b) => {
      const asel = selectedTables.includes(a.name);
      const bsel = selectedTables.includes(b.name);
      if (asel !== bsel) return asel ? -1 : 1;
      const ia = indexMap.get(a.name) ?? 0;
      const ib = indexMap.get(b.name) ?? 0;
      return ia - ib;
    });
  }, [tables, tableFilter, selectedTables]);

  const llmLabel = (t: string) => (
    t === 'azure' ? 'Azure OpenAI'
      : t === 'openai' ? 'OpenAI'
        : t === 'gemini' ? 'Gemini'
          : t === 'openai_compatible' ? 'OpenAI Compatible'
            : t === 'anthropic' ? 'Anthropic'
              : t === 'ollama' ? 'Ollama'
                : t
  );

  // Batch save all inline charts for a message's extracted results
  const addAllExtractedCharts = async (msgIndex: number, targetDashboardId?: string) => {
    try {
      setBatchError(prev => ({ ...prev, [msgIndex]: '' }));
      setSavingBatch(prev => ({ ...prev, [msgIndex]: true }));
      const msg = messages[msgIndex];
      if (!msg) throw new Error('Message not found');
      const dashId = targetDashboardId || activeDashboardId;
      if (!dashId) throw new Error('Select a dashboard first');
      const results = Array.isArray(msg.multiResults) ? msg.multiResults : [];
      const charts = Array.isArray(msg.multiInlineChart) ? msg.multiInlineChart : [];
      const sqls = Array.isArray(msg.multiExecutedSql) ? msg.multiExecutedSql : (Array.isArray(msg.extractedSql) ? msg.extractedSql.map(x => String(x)) : []);
      const bodies: any[] = [];
      for (let i = 0; i < results.length; i++) {
        const res = results[i] as any;
        if (!res || res.error) continue;
        const hasRows = Array.isArray(res.rows) && res.rows.length > 0;
        if (!hasRows) continue;
        
        const inlinesRaw = charts[i];
        // Handle both single object (legacy) and array of objects (new)
        const inlines: any[] = Array.isArray(inlinesRaw) ? inlinesRaw : (inlinesRaw ? [inlinesRaw] : []);
        const sqlQuery = String(sqls[i] ?? '');

        const colsRaw = Array.isArray(res?.columns) && (res.columns as any[]).length > 0
          ? (res.columns as any[])
          : (Array.isArray(res?.rows) && res.rows.length > 0 ? Object.keys(res.rows[0]) : []);
        
        // Ensure columns are strings
        const colsMulti = colsRaw.map((c: any) => 
          typeof c === 'string' ? c : (c?.name ? String(c.name) : String(c))
        );
        
        if (inlines.length === 0) {
            // Fallback to table if no chart
            bodies.push({
              type: 'table',
              name: `Query ${i + 1}`,
              config: { 
                sqlQuery,
                dataOverride: {
                  columns: colsMulti,
                  rows: res.rows
                }
              },
              position: { x: 0, y: 0, w: 6, h: 6 },
            });
        } else {
            for (const inline of inlines) {
                const type = inline?.type || 'table';
                const title = inline?.title || `Query ${i + 1}`;
                const cfg = inline?.config || {};
                bodies.push({
                  type,
                  name: title,
                  config: {
                    sqlQuery,
                    ...cfg,
                    dataOverride: {
                      columns: colsMulti,
                      rows: res.rows
                    }
                  },
                  position: { x: 0, y: 0, w: 6, h: 6 },
                });
            }
        }
      }
      if (!bodies.length) throw new Error('No charts available to add');
      await ensureApiBase();
      // Save charts sequentially to avoid API contention
      for (const body of bodies) {
        const res = await fetch(`${API_BASE}/dashboards/${dashId}/charts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const msg = await res.text().catch(() => '');
          throw new Error(msg || 'Failed to save chart');
        }
        // Brief throttling to keep UI responsive
        await new Promise(r => setTimeout(r, 50));
      }
      // Refresh dashboards once after batch
      await loadDashboards();
      try {
        window.dispatchEvent(new CustomEvent('refresh-all-charts'));
      } catch { }
    } catch (e: any) {
      setBatchError(prev => ({ ...prev, [msgIndex]: e?.message || 'Batch save failed' }));
    } finally {
      setSavingBatch(prev => ({ ...prev, [msgIndex]: false }));
    }
  };

  // Save a single inline chart (for non-extracted single result) to dashboard
  const addInlineChartToDashboard = async (msgIndex: number, targetDashboardId?: string) => {
    try {
      setSaveError(prev => ({ ...prev, [`single-${msgIndex}`]: '' }));
      setSavingSingle(prev => ({ ...prev, [msgIndex]: true }));
      const msg = messages[msgIndex];
      if (!msg) throw new Error('Message not found');
      const dashId = targetDashboardId || activeDashboardId;
      if (!dashId) throw new Error('Select a dashboard first');
      const inline = (msg as any).inlineChart || null;
      const res = (msg as any).result as any;
      const hasRows = Array.isArray(res?.rows) && res.rows.length > 0;
      if (!inline || !hasRows) throw new Error('No chart available to add');
      const sqlQuery = String((msg as any).executedSql || '');
      const colsInline = (Array.isArray(res?.columns) && (res.columns as any[]).length)
        ? (res.columns as string[])
        : (Array.isArray(res?.rows) && res.rows.length ? Object.keys(res.rows[0]) : []);
      const body = {
        type: inline.type,
        name: inline.title || 'Inline Chart',
        config: {
          sqlQuery,
          ...(inline.config || {}),
          dataOverride: {
            columns: Array.isArray(colsInline) ? colsInline : [],
            rows: Array.isArray(res?.rows) ? res.rows : [],
          },
        },
        position: { x: 0, y: 0, w: 6, h: 6 },
      };
      await ensureApiBase();
      const resSave = await fetch(`${API_BASE}/dashboards/${dashId}/charts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (!resSave.ok) {
        const msg = await resSave.text().catch(() => '');
        throw new Error(msg || 'Failed to save chart');
      }
      await loadDashboards();
      try { window.dispatchEvent(new CustomEvent('refresh-all-charts')); } catch { }
    } catch (e: any) {
      setSaveError(prev => ({ ...prev, [`single-${msgIndex}`]: e?.message || 'Save failed' }));
    } finally {
      setSavingSingle(prev => ({ ...prev, [msgIndex]: false }));
    }
  };

  // Save an AI suggestion chart to dashboard
  const addSuggestionChartToDashboard = async (msgIndex: number, sIndex: number, suggestion: SuggestedChart, sqlQuery: string, targetDashboardId?: string) => {
    const key = `suggest-${msgIndex}-${sIndex}`;
    try {
      setSaveError(prev => ({ ...prev, [key]: '' }));
      setSavingSuggestion(prev => ({ ...prev, [key]: true }));
      const dashId = targetDashboardId || activeDashboardId;
      if (!dashId) throw new Error('Select a dashboard first');
      if (!suggestion) throw new Error('No chart available to add');
      const sugCols = Array.isArray((suggestion as any)?.data?.columns)
        ? ((suggestion as any).data.columns as any[]).map((c: any) => (typeof c === 'string' ? c : String(c?.name || '')))
        : [];
      const sugRows = Array.isArray((suggestion as any)?.data?.rows)
        ? ((suggestion as any).data.rows as any[])
        : [];
      const body = {
        type: suggestion.type,
        name: suggestion.title || 'Suggested Chart',
        config: {
          sqlQuery: String(sqlQuery || ''),
          ...(suggestion.config || {}),
          dataOverride: {
            columns: Array.isArray(sugCols) ? (sugCols as string[]) : [],
            rows: Array.isArray(sugRows) ? sugRows : [],
          },
        },
        position: { x: 0, y: 0, w: 6, h: 6 },
      };
      await ensureApiBase();
      const res = await fetch(`${API_BASE}/dashboards/${dashId}/charts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(msg || 'Failed to save chart');
      }
      await loadDashboards();
      try { window.dispatchEvent(new CustomEvent('refresh-all-charts')); } catch { }
    } catch (e: any) {
      setSaveError(prev => ({ ...prev, [key]: e?.message || 'Save failed' }));
    } finally {
      setSavingSuggestion(prev => ({ ...prev, [key]: false }));
    }
  };

  // Save a per-extracted inline chart to dashboard
  const addMultiInlineChartToDashboard = async (msgIndex: number, qIndex: number, sqlQuery: string, chartIndex: number = 0, targetDashboardId?: string) => {
    const key = `inline-${msgIndex}-${qIndex}-${chartIndex}`;
    try {
      setSaveError(prev => ({ ...prev, [key]: '' }));
      setSavingSuggestion(prev => ({ ...prev, [key]: true }));
      const msg = messages[msgIndex];
      if (!msg) throw new Error('Message not found');
      const dashId = targetDashboardId || activeDashboardId;
      if (!dashId) throw new Error('Select a dashboard first');

      const inlineRaw = Array.isArray((msg as any).multiInlineChart) ? ((msg as any).multiInlineChart[qIndex] || null) : null;
      let inline: any = null;
      if (Array.isArray(inlineRaw)) {
         inline = inlineRaw[chartIndex];
      } else {
         inline = inlineRaw;
      }

      const res = Array.isArray((msg as any).multiResults) ? ((msg as any).multiResults[qIndex] as any) : null;
      const hasRows = Array.isArray(res?.rows) && res.rows.length > 0;
      if (!inline || !hasRows) throw new Error('No chart available to add');
      
      const colsRaw = (Array.isArray(res?.columns) && (res.columns as any[]).length)
        ? (res.columns as any[])
        : (Array.isArray(res?.rows) && res.rows.length ? Object.keys(res.rows[0]) : []);
      
      // Ensure columns are formatted as strings (or objects with name)
      const colsMulti = colsRaw.map((c: any) => 
          typeof c === 'string' ? c : (c?.name ? String(c.name) : String(c))
      );

      const body = {
        type: inline.type,
        name: inline.title || `Query ${qIndex + 1} Chart ${chartIndex + 1}`,
        config: {
          sqlQuery: String(sqlQuery || ''),
          ...(inline.config || {}),
          dataOverride: {
            columns: colsMulti,
            rows: Array.isArray(res?.rows) ? res.rows : [],
          },
        },
        position: { x: 0, y: 0, w: 6, h: 6 },
      };
      await ensureApiBase();
      const resSave = await fetch(`${API_BASE}/dashboards/${dashId}/charts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (!resSave.ok) {
        const msgt = await resSave.text().catch(() => '');
        throw new Error(msgt || 'Failed to save chart');
      }
      await loadDashboards();
      try { window.dispatchEvent(new CustomEvent('refresh-all-charts')); } catch { }
    } catch (e: any) {
      setSaveError(prev => ({ ...prev, [key]: e?.message || 'Save failed' }));
    } finally {
      setSavingSuggestion(prev => ({ ...prev, [key]: false }));
    }
  };



  useEffect(() => {
    const prev = prevMsgLenRef.current;
    if (messages.length > prev && autoScrollEnabled && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
    prevMsgLenRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    loadTables();
    loadLLMStatus();
  }, []);

  // Open chat and load conversation from URL query (supports new-tab opening)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const shouldOpen = params.get('openChat');
      if (shouldOpen && !isChatOpen) openChat();
    } catch { }
  }, []);

  // Switch conversations when URL changes via browser back/forward
  useEffect(() => {
    const onPop = async () => {
      try {
        const id = getConversationIdFromURL();
        if (!id) {
          const fallbackId = history.lastActiveId || history.conversations[0]?.id || null;
          setConversationId(fallbackId || null);
          activeConvRef.current = fallbackId || null;
          const active = history.conversations.find(c => c.id === fallbackId);
          // Filter persisted messages by the currently selected conversation
          setMessages(normalizeServerMessages(active?.messages || [], fallbackId || undefined));
          return;
        }
        const next = setLastActive(history, id);
        setHistory(next);
        setConversationId(id);
        activeConvRef.current = id;
        const active = next.conversations.find(c => c.id === id);
        // Filter persisted messages by the currently selected conversation
        setMessages(normalizeServerMessages(active?.messages || [], id));
        try {
          await ensureApiBase();
          const mres = await fetch(`${API_BASE}/state/conversations/${id}/messages?limit=500`, { headers: { 'x-client-id': getClientId() } });
          if (mres.ok) {
            const mj = await mres.json();
            if (Array.isArray(mj?.messages)) setMessages(normalizeServerMessages(mj.messages, id));
          }
        } catch { }
      } catch { }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [history.conversations.length]);

  // Keep active conversation reference in sync for guarding async handlers
  // Keep only a lightweight reference; no persistence or session restore
  useEffect(() => { activeConvRef.current = conversationId || null; }, [conversationId]);

  // Persist messages to session storage per conversation
  // Removed session message persistence

  // Visual confirmation when table selection changes
  const [isContextSwitchBanner, setIsContextSwitchBanner] = useState<boolean>(false);
  const [contextSwitchText, setContextSwitchText] = useState<string>('');
  const prevSelectionRef = useRef<string>('');
  useEffect(() => {
    const curr = JSON.stringify({ selectedTables: [...selectedTables].sort() });
    if (prevSelectionRef.current && prevSelectionRef.current !== curr) {
      const tablesNow = selectedTables;
      const display = tablesNow.length ? `Tables: ${formatTablesDisplay(tablesNow)}` : 'Tables: none selected';
      setContextSwitchText(`Table context updated — ${display}`);
      setIsContextSwitchBanner(true);
      setTimeout(() => setIsContextSwitchBanner(false), 1500);
    }
    prevSelectionRef.current = curr;
  }, [selectedTables.join(','), tables.length]);

  // Persist conversation whenever messages or context changes (debounced)
  // Removed persistent conversation saving

  // Shared function: load schema for current selection or all DB
  const loadSelectedSchema = async (signal?: AbortSignal, requestId?: number) => {
    try {
      await ensureApiBase();
      const tablesToSend = selectedTables;
      const res = await fetch(`${API_BASE}/chat/schema`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables: tablesToSend }),
        signal,
      });
      if (!res.ok) {
        let msg = '';
        try { msg = (await res.json())?.error || ''; } catch { msg = await res.text(); }
        // Ignore stale responses
        if (requestId && requestId !== schemaReqIdRef.current) { return; }
        // Treat network aborts/refreshes as non-errors in UI
        const isAborted = /ERR_ABORTED/i.test(String(msg)) || /aborted/i.test(String(msg));
        setSchemaError(isAborted ? null : (msg || 'Failed to cache schema'));
        setFailedTables([]);
        setSchemaTables([]);
        return;
      }
      const json = await res.json();
      // Ignore stale responses
      if (requestId && requestId !== schemaReqIdRef.current) { return; }
      setSchemaVersion(Number(json.version || 0));
      setFailedTables(Array.isArray(json.failedTables) ? json.failedTables : []);
      setSchemaError(null);
      setSchemaTables(Array.isArray(json.tables) ? json.tables : []);
    } catch (e: any) {
      // Ignore aborted fetches or dev-server HMR reload disruptions
      const errStr = String(e?.message || e || '');
      if (e?.name === 'AbortError' || /ERR_ABORTED/i.test(errStr) || /aborted/i.test(errStr)) { return; }
      // Ignore stale errors
      if (requestId && requestId !== schemaReqIdRef.current) { return; }
      setSchemaError(String(e?.message || e));
      setFailedTables([]);
      setSchemaTables([]);
    }
  };

  // Proactively load and cache schema when selection changes
  useEffect(() => {
    // Increment request id and issue fetch without aborting previous ones;
    // stale responses are ignored using the request id guard.
    const currentId = ++schemaReqIdRef.current;
    loadSelectedSchema(undefined, currentId);
  }, [selectedTables]);

  // Persist non-history chat settings across reloads
  useEffect(() => {
    try {
      const raw = localStorage.getItem('trae2.chat.settings.v1');
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data?.selectedTables)) setSelectedTables(data.selectedTables);
        if (typeof data?.persona === 'string') setPersona(data.persona);
        if (Array.isArray(data?.schemaTables)) setSchemaTables(data.schemaTables);
        if (typeof data?.schemaVersion === 'number') setSchemaVersion(Number(data.schemaVersion) || 0);
      }
    } catch { }
    // Also restore selected tables from server persistence if available
    (async () => {
      try {
        await ensureApiBase();
        const res = await fetch(`${API_BASE}/state/selected-tables`);
        if (res.ok) {
          const j = await res.json();
          if (Array.isArray(j?.tables)) setSelectedTables(j.tables);
        }
      } catch { }
    })();
  }, []);
  useEffect(() => {
    try {
      const payload = { selectedTables, persona, schemaTables, schemaVersion };
      localStorage.setItem('trae2.chat.settings.v1', JSON.stringify(payload));
    } catch { }
  }, [selectedTables, persona, schemaTables, schemaVersion]);

  // Persist selected tables to server when they change
  useEffect(() => {
    (async () => {
      try {
        await ensureApiBase();
        await fetch(`${API_BASE}/state/selected-tables`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tables: selectedTables })
        });
      } catch { }
    })();
  }, [selectedTables]);

  const onCreateNewConversation = async () => {
    if (creatingConv) return;
    setCreatingConv(true);
    try {
      const title = `Conversation ${history.conversations.length + 1}`;
      const next = addConversation(history, title);
      // Save to server first so the conversation exists before UI updates
      await ensureApiBase();
      const res = await fetch(`${API_BASE}/state/conversations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-client-id': getClientId() },
        body: JSON.stringify({ version: 1, lastActiveId: next.lastActiveId, conversations: next.conversations })
      });
      if (!res.ok) {
        let msg = '';
        try { const j = await res.json(); msg = String(j?.error || j?.details || JSON.stringify(j)); } catch { msg = await res.text(); }
        throw new Error(msg || `HTTP ${res.status}`);
      }
      // Server ok — update local state and navigate within this SPA
      setHistory(next);
      const newId = next.lastActiveId || '';
      setConversationId(newId || null);
      activeConvRef.current = newId || null;
      setMessages([]);
      await saveHistory({ ...next, encrypted: false }, null);
      // Update URL without opening a new tab
      try {
        const url = buildConversationURL(newId);
        window.history.pushState(null, '', url);
      } catch { }
      // Ensure chat interface is visible
      try { if (!isChatOpen) openChat(); } catch { }
    } catch (e: any) {
      console.error('Create conversation failed:', e);
      alert(`Failed to create conversation: ${String(e?.message || e)}`);
    } finally {
      setCreatingConv(false);
    }
  };

  const onDeleteConversation = async (id: string) => {
    if (deletingConvId) return;
    setDeletingConvId(id);
    try {
      // Cascade delete on server to remove conversation and all its messages
      await ensureApiBase();
      const resp = await fetch(`${API_BASE}/state/conversations/${id}`, {
        method: 'DELETE',
        headers: { 'x-client-id': getClientId() },
      });
      if (!resp.ok) {
        let msg = '';
        try { const j = await resp.json(); msg = String(j?.error || j?.details || JSON.stringify(j)); } catch { msg = await resp.text(); }
        throw new Error(msg || `HTTP ${resp.status}`);
      }
      const next = deleteConversation(history, id);
      setHistory(next);
      setConversationId(next.lastActiveId || null);
      activeConvRef.current = next.lastActiveId || null;
      const active = next.conversations.find(c => c.id === next.lastActiveId);
      setMessages(active?.messages || []);
      await saveHistory({ ...next, encrypted: false }, null);
      // Sync to server state explicitly after deletion
      await fetch(`${API_BASE}/state/conversations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-client-id': getClientId() },
        body: JSON.stringify({ version: 1, lastActiveId: next.lastActiveId, conversations: next.conversations })
      });
      // If we are on the deleted conversation page, navigate within SPA
      const urlConvId = getConversationIdFromURL();
      if (urlConvId === id) {
        try {
          const target = next.lastActiveId ? buildConversationURL(next.lastActiveId) : (window.location.origin + window.location.pathname);
          window.history.pushState(null, '', target);
        } catch { }
      }
    } catch (e: any) {
      console.error('Delete conversation failed:', e);
      alert(`Failed to delete conversation: ${String(e?.message || e)}`);
    } finally {
      setDeletingConvId(null);
    }
  };

  const onSelectConversation = async (id: string) => {
    const next = setLastActive(history, id);
    setHistory(next);
    setConversationId(id);
    activeConvRef.current = id;
    const active = history.conversations.find(c => c.id === id);
    // Ensure only messages from the selected conversation are shown immediately
    setMessages(normalizeServerMessages(active?.messages || [], id));
    // Try to load server-side messages for this conversation as the source of truth
    try {
      await ensureApiBase();
      const mres = await fetch(`${API_BASE}/state/conversations/${id}/messages?limit=500`, { headers: { 'x-client-id': getClientId() } });
      if (mres.ok) {
        const mj = await mres.json();
        if (Array.isArray(mj?.messages)) {
          setMessages(normalizeServerMessages(mj.messages, id));
        }
      }
    } catch { }
    await saveHistory({ ...next, encrypted: false }, null);
    try {
      await ensureApiBase();
      await fetch(`${API_BASE}/state/conversations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-client-id': getClientId() },
        body: JSON.stringify({ version: 1, lastActiveId: next.lastActiveId, conversations: next.conversations })
      });
    } catch { }
    // Navigate within SPA to reflect selected conversation
    try {
      const url = buildConversationURL(id);
      window.history.pushState(null, '', url);
    } catch { }
    // Ensure chat interface is visible
    try { if (!isChatOpen) openChat(); } catch { }
  };

  // After a chart is saved, auto-execute the latest generated SQL and show data
  useEffect(() => {
    const onChartSaved = () => {
      // find last assistant message with SQL
      let idx: number | undefined = undefined;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant' && messages[i].sql) { idx = i; break; }
      }
      if (idx !== undefined && messages[idx]?.sql) {
        executeSQL(messages[idx].sql!, idx);
      }
    };
    window.addEventListener('chart-saved', onChartSaved);
    return () => window.removeEventListener('chart-saved', onChartSaved);
  }, [messages]);

  const loadTables = async (signal?: AbortSignal) => {
    try {
      await ensureApiBase();
      // Use the same endpoint as Add Chart for consistent table listing
      const res = await fetch(`${API_BASE}/data/tables`, { signal });
      if (!res.ok) {
        // Try to extract a meaningful error message from the server
        let msg = `Failed to load tables (HTTP ${res.status})`;
        try {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await res.json();
            const parts = [j?.error, j?.details, j?.code].filter(Boolean);
            if (parts.length) msg = parts.join(' - ');
          } else {
            const text = await res.text();
            if (text) msg = text;
          }
        } catch {
          // ignore parsing errors and keep default message
        }
        throw new Error(msg);
      }
      const data = await res.json();
      // Map to the structure used by the sidebar
      const mapped = (data.tables || []).map((t: any) => ({ name: t.TABLE_NAME, columns: [] }));
      setTables(mapped);
      setTablesError(null);
    } catch (e: any) {
      if (e?.name === 'AbortError') { return; }
      console.error('Failed to load tables:', e);
      const msg = (typeof e?.message === 'string' && e.message)
        ? e.message
        : 'Could not load tables from the database.';
      setTablesError(msg);
    }
  };

  const loadLLMStatus = async () => {
    try {
      await ensureApiBase();
      setStatusLoading(true);
      const res = await fetch(`${API_BASE}/chat/status`);
      const data = await res.json();
      setLLMConfigured(!!data.configured);
      setLLMConnected(!!(data.connected ?? data.configured));
      setAvailableLLMs(Array.isArray(data.types) ? data.types : []);
      // Prefer the server-reported current provider if available
      // If we have a connected provider and none selected yet, default to current
      if (data.current && data.types?.includes(data.current)) {
        setLLMType(data.current);
      } else if (data.types && data.types.length && !data.types.includes(llmType)) {
        setLLMType(data.types[0]);
      }
    } catch (e) {
      setLLMConnected(false);
      setLLMConfigured(false);
      setAvailableLLMs([]);
    } finally {
      setStatusLoading(false);
    }
  };

  const onSend = async (override?: string) => {
    const msgText = typeof override === 'string' ? override : input;
    if (!msgText.trim() || loading) return;
    // Auto-create a conversation if none is active
    if (!conversationId) {
      await onCreateNewConversation();
    }
    const convSnapshot = activeConvRef.current;

    const userMessage = msgText;
    setInput('');
    const userIndex = messages.length;
    pendingUserIndexRef.current = userIndex;
    // Extract prose from user prompt; SQL can be revealed via Extract SQL later
    const { text: userText } = extractSQLAndText(userMessage);

       // Update conversation title if this is the first message
       if (messages.length === 0 && conversationId) {
          const newTitle = userText.slice(0, 30) + (userText.length > 30 ? '...' : '');
          // Use callback updater to satisfy TS requirements
          const updated = updateConversation(history, conversationId, (c) => ({ ...c, title: newTitle }));
          setHistory(updated);
       saveHistory(updated, null);
       // Sync title update to server
       (async () => {
          try {
             await ensureApiBase();
             await fetch(`${API_BASE}/state/conversations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-client-id': getClientId() },
                body: JSON.stringify({ version: 1, lastActiveId: updated.lastActiveId, conversations: updated.conversations })
             });
          } catch {}
       })();
    }

    // Detect chart intent from the user text
    const intent = detectChartIntent(userText);
    // Compute tables in focus for this interaction
    const useTables = selectedTables;
    setMessages(prev => [...prev, { role: 'user', content: userText, status: 'sending', tablesContext: useTables, ts: Date.now(), id: uuidv4() }]);
    setLoading(true);

    try {
      // Ensure tables are provided to avoid Invalid request
      if (!useTables.length) {
        // No tables available: gracefully inform user and abort send
        setMessages(prev => prev.map((m, i) => i === userIndex ? { ...m, status: 'sent' } : m));
        setMessages(prev => [...prev, { role: 'assistant', content: 'No tables available. Open Tables and select at least one.', ts: Date.now(), id: uuidv4() }]);
        setLoading(false);
        return;
      }

      // Always delegate to API/LLM; avoid local clarifier responses
      // If needed, the backend can request clarifications.


      const clientMsgId = uuidv4();
      await ensureApiBase();
      const res = await fetch(`${API_BASE}/chat/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-client-id': getClientId() },
        body: JSON.stringify({
          prompt: userMessage,
          llmType,
          tables: useTables,
          trace: true,
          conversationId: convSnapshot || undefined,
          clientMessageId: clientMsgId,
        })
      });

      if (!res.ok) {
        let errMsg = '';
        let errJson: any = null;
        try {
          errJson = await res.json();
          errMsg = formatErrorMessage(errJson);
        } catch {
          errMsg = await res.text();
        }
        if (errJson && typeof errJson === 'object') {
          const errText = String(errJson?.error || '');
          if (/LLM not configured/i.test(errText)) {
            setLLMConnected(false);
            setLLMConfigured(false);
          }
          if (errJson?.code === 'LLMNotConnected' || /configured but not connected/i.test(errText)) {
            setLLMConnected(false);
            setLLMConfigured(true);
          }
        }
        setMessages(prev => [...prev, { role: 'assistant', content: errMsg, ts: Date.now(), id: uuidv4() }]);
        return;
      }
      const data = await res.json();
      // Guard against conversation switches mid-flight
      if (activeConvRef.current !== convSnapshot) {
        return;
      }
      // Update schema transmission status for clear feedback
      try {
        if (typeof (data as any)?.schemaIncluded !== 'undefined') {
          setSchemaError((data as any).schemaIncluded ? null : 'Schema was not included in AI request');
        }
        if (Array.isArray((data as any)?.failedTables)) {
          setFailedTables((data as any).failedTables);
        }
        if (typeof (data as any)?.schemaVersion !== 'undefined') {
          setSchemaVersion(Number((data as any).schemaVersion || 0));
        }
      } catch { }
      // Track server-provided conversation id if persistence is enabled
      try {
        const serverConvId = (data as any)?.conversationId;
        if (serverConvId && serverConvId !== activeConvRef.current) {
          // Align active conversation id if server generated a new one
          setConversationId(serverConvId);
          activeConvRef.current = serverConvId;
          // Update local conversation record id to keep history consistent
          const oldId = convSnapshot || undefined;
          if (oldId) {
            setHistory(h => ({
              ...h,
              conversations: h.conversations.map(c => c.id === oldId ? { ...c, id: serverConvId } : c),
              lastActiveId: serverConvId,
            }));
          }
          await saveHistory({ ...history, lastActiveId: serverConvId, encrypted: false }, null);
        }
      } catch { }
      // Normalize non-string responses to avoid '[object Object]' rendering
      const displayResponse = normalizeLLMResponse((data as any)?.response);
      // Extract only narrative text for assistant message content
      const renderContent = extractNarrativeText(displayResponse);
      // Parse chart tags from the assistant response
      const parsedTags = parseChartTags(displayResponse);

      // Build extracted queries list, merging server-provided sqlQueries/sqlQuery with client-side extraction
      // Normalize and split any server-provided entries to avoid narrative+SQL blocks
      const serverQueriesRaw: string[] = Array.isArray((data as any)?.sqlQueries) ? ((data as any).sqlQueries as string[]) : [];
      const serverQueries = serverQueriesRaw.flatMap(q => extractAllSQL(String(q || '')));
      const extractedClient = extractAllSQL(displayResponse, (data as any)?.sqlQuery, false);
      const merged = [...serverQueries, ...extractedClient];
      // Do not deduplicate queries to support multiple charts (e.g. Pie + Donut) for the same SQL query
      let queries = merged.map(q => normalizeSQL(q));
      // Fallback: if no <sql> tags found, try to extract a single SQL from fenced code or lines
      if (!queries.length) {
        const { sql } = extractSQLAndText(displayResponse, (data as any)?.sqlQuery);
        if (sql && isLikelySQL(sql)) {
          queries = [normalizeSQL(sql)];
        }
      }
      const showExtracted = queries.length > 0;


      // mark last user message as sent
      // Guard: ensure still in same conversation when applying updates
      if (activeConvRef.current !== convSnapshot) { return; }
      setMessages(prev => prev.map((m, i) => i === userIndex ? { ...m, status: 'sent' } : m));
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: renderContent,
        // Do not render a separate single SQL block. Show all queries under Extracted SQL.
        result: null,
        extractedSql: showExtracted ? queries : undefined,
        showExtracted: showExtracted ? true : undefined,
        multiResults: showExtracted ? [] : undefined,
        tablesContext: useTables,
        ts: Date.now(),
        debugTrace: (data as any)?.trace || undefined,
        hideSql: false,
        chartRequested: !!intent.requested,
        chartTags: parsedTags || undefined,
        multiChartTags: extractMultiChartTags(displayResponse),
        inlineChart: null,
        multiInlineChart: [],
      }]);

      // Auto-run ALL extracted SQL when charts are requested or tags are present
      if ((intent.requested || !!parsedTags) && queries.length > 0) {
        await executeAllExtracted(userIndex + 1, queries);
      }
    } catch (e: any) {
      // still mark message as sent, even on error
      if (activeConvRef.current === convSnapshot) {
        setMessages(prev => prev.map((m, i) => i === (pendingUserIndexRef.current ?? -1) ? { ...m, status: 'sent' } : m));
        setMessages(prev => [...prev, { role: 'assistant', content: String(e?.message || e), ts: Date.now(), id: uuidv4() }]);
      }
    } finally {
      if (activeConvRef.current === convSnapshot) setLoading(false);
    }
  };

  const executeSQL = async (sql: string, msgIndex: number) => {
    const convSnapshot = activeConvRef.current;
    try {
      // Clean and strip trailing semicolons before sending to server
      const cleanedRaw = normalizeSQL(String(sql));
      const cleanedSql = cleanedRaw.replace(/;+\s*$/, '');
      // Keep table context visible for result messages
      const tablesForMsg = selectedTables;
      await ensureApiBase();
      const sqlRes = await fetch(`${API_BASE}/chat/execute-sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sqlQuery: cleanedSql })
      });
      if (!sqlRes.ok) {
        let msgStr = '';
        try {
          const errJson = await sqlRes.json();
          const details = errJson?.details;
          const detailMsg = typeof details === 'string' ? details : (details?.message || null);
          msgStr = detailMsg || errJson?.error || JSON.stringify(errJson);
        } catch {
          try { msgStr = await sqlRes.text(); } catch { msgStr = 'Query failed'; }
        }
        updateMessageResult(msgIndex, { error: msgStr });
        return;
      }
      const sqlData = await sqlRes.json();
      if (activeConvRef.current !== convSnapshot) { return; }
      const finalData = sqlData;

      // Only auto-scroll on appended messages; this single run should not move
      setAutoScrollEnabled(false);
      // Compute rule-based chart suggestions for persistence
      const colsRaw = Array.isArray(finalData?.columns) && ((finalData.columns as any[]).length > 0)
        ? (finalData.columns as any[])
        : (finalData.rows?.length ? Object.keys(finalData.rows[0]) : []);
      // Attach result, and when chart was requested, render inline chart; otherwise do not auto-suggest
      setMessages(prev => prev.map((m, i) => {
        if (i !== msgIndex) return m;
        const next: any = { ...m, result: finalData, executedSql: cleanedSql, tablesContext: (m.tablesContext && m.tablesContext.length ? m.tablesContext : tablesForMsg) };
        if (m.chartRequested) {
          const inline = makeInlineChartFromData(finalData, m.chartTags, cleanedSql);
          if (inline?.error) {
            return { ...next, aiError: inline.error };
          }
          return { ...next, inlineChart: inline?.chart || null };
        }
        // When no chart is requested, compute and attach rule-based suggestions (if enabled)
        if (analysisEnabled) {
          try {
            const suggestions = buildChartSuggestions(finalData?.rows || [], colsRaw || []);
            return { ...next, aiSuggestions: suggestions };
          } catch {
            return next;
          }
        }
        return next;
      }));
      setTimeout(() => setAutoScrollEnabled(true), 300);

    } catch (e: any) {
      if (activeConvRef.current === convSnapshot) updateMessageResult(msgIndex, { error: String(e?.message || e) });
    }
  };

  const updateMessageResult = (index: number, result: any) => {
    setMessages(prev => prev.map((m, i) => i === index ? { ...m, result } : m));
  };

  // Removed SQL-only retry logic to restore default LLM behavior with no forced guidance


  const updateMessageMultiResult = (index: number, qIndex: number, result: any) => {
    setMessages(prev => prev.map((m, i) => {
      if (i !== index) return m;
      const arr = (m.multiResults || []).slice();
      while (arr.length <= qIndex) arr.push(null);
      arr[qIndex] = result;
      return { ...m, multiResults: arr };
    }));
  };


  const onToggleTrace = (index: number) => {
    setMessages(prev => prev.map((m, i) => i === index ? { ...m, showTrace: !m.showTrace } : m));
  };



  const executeExtractSQL = async (sql: string, msgIndex: number, qIndex: number, suppressAutoScroll?: boolean) => {
    const convSnapshot = activeConvRef.current;
    try {
      const rawSql = normalizeSQL(String(sql));
      const cleanedSql = rawSql.replace(/;+\s*$/, '');
      const tablesForMsg = selectedTables;

      await ensureApiBase();
      const sqlRes = await fetch(`${API_BASE}/chat/execute-sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sqlQuery: cleanedSql })
      });
      if (!sqlRes.ok) {
        let msgStr = '';
        let errDetails = {};
        try {
          const errJson = await sqlRes.json();
          msgStr = formatErrorMessage(errJson);
          errDetails = errJson?.details || {};
          console.error('SQL execution error:', errJson);
        } catch {
          msgStr = await sqlRes.text();
        }
        if (suppressAutoScroll) setAutoScrollEnabled(false);
        // Attach error while keeping the table context snapshot
        setMessages(prev => prev.map((m, i) => {
          if (i !== msgIndex) return m;
          const arr = (m.multiResults || []).slice();
          while (arr.length <= qIndex) arr.push(null);
          arr[qIndex] = { error: msgStr, details: errDetails, sql: cleanedSql } as any;
          return { ...m, multiResults: arr, tablesContext: (m.tablesContext && m.tablesContext.length ? m.tablesContext : tablesForMsg) };
        }));
        if (suppressAutoScroll) setTimeout(() => setAutoScrollEnabled(true), 300);
        return;
      }
      const sqlData = await sqlRes.json();
      if (activeConvRef.current !== convSnapshot) { return; }
      const finalData = sqlData;
      if (suppressAutoScroll) setAutoScrollEnabled(false);
      // Compute rule-based chart suggestions for this extracted query
      const colsRaw = Array.isArray(finalData?.columns) && ((finalData.columns as any[]).length > 0)
        ? (finalData.columns as any[])
        : (finalData.rows?.length ? Object.keys(finalData.rows[0]) : []);
      // Render inline chart when explicitly requested; otherwise do not auto-suggest
      setMessages(prev => prev.map((m, i) => {
        if (i !== msgIndex) return m;
        const arr = (m.multiResults || []).slice();
        while (arr.length <= qIndex) arr.push(null);
        arr[qIndex] = finalData;
        const execArr = (m.multiExecutedSql || []).slice();
        while (execArr.length <= qIndex) execArr.push('');
        execArr[qIndex] = cleanedSql;
        if (m.chartRequested) {
          const perTags = Array.isArray(m.multiChartTags) ? (m.multiChartTags[qIndex] || null) : null;
          
          let generatedCharts: Array<{ title: string; type: string; config: any }> = [];
          let firstError = '';
          
          if (perTags && Array.isArray(perTags) && perTags.length > 0) {
             for (const tag of perTags) {
                const inline = makeInlineChartFromData(finalData, tag, cleanedSql);
                if (inline.chart) generatedCharts.push(inline.chart);
                if (inline.error && !firstError) firstError = inline.error;
             }
          } else {
             // Fallback if no tags but chart requested
             const inline = makeInlineChartFromData(finalData, undefined, cleanedSql);
             if (inline.chart) generatedCharts.push(inline.chart);
             if (inline.error) firstError = inline.error;
          }

          const inlineArr = (m.multiInlineChart || []).slice();
          while (inlineArr.length <= qIndex) inlineArr.push(null);
          inlineArr[qIndex] = generatedCharts.length ? generatedCharts : null;
          
          let next: any = { ...m, multiResults: arr, multiExecutedSql: execArr, multiInlineChart: inlineArr, tablesContext: (m.tablesContext && m.tablesContext.length ? m.tablesContext : tablesForMsg) };
          
          if (firstError && !generatedCharts.length) {
            const errs = Array.isArray(m.multiAIError) ? m.multiAIError.slice() : [];
            while (errs.length <= qIndex) errs.push('');
            errs[qIndex] = firstError;
            next.multiAIError = errs;
          }
          return next;
        }
        // When no chart is requested, compute and attach rule-based suggestions for this query (if enabled)
        let next: any = { ...m, multiResults: arr, multiExecutedSql: execArr, tablesContext: (m.tablesContext && m.tablesContext.length ? m.tablesContext : tablesForMsg) };
        if (analysisEnabled) {
          try {
            const suggestions = buildChartSuggestions(finalData?.rows || [], colsRaw || []);
            const suggArr = Array.isArray(m.multiAISuggestions) ? m.multiAISuggestions.slice() : [];
            while (suggArr.length <= qIndex) suggArr.push(null);
            suggArr[qIndex] = suggestions as any;
            next.multiAISuggestions = suggArr;
          } catch { }
        }
        return next;
      }));
      if (suppressAutoScroll) setTimeout(() => setAutoScrollEnabled(true), 300);
    } catch (e: any) {
      console.error('SQL execution client error:', e);
      if (suppressAutoScroll) setAutoScrollEnabled(false);
      if (activeConvRef.current === convSnapshot) {
        updateMessageMultiResult(msgIndex, qIndex, { error: String(e?.message || e) });
      }
      if (suppressAutoScroll) setTimeout(() => setAutoScrollEnabled(true), 300);
    }
  };

  // Run AI Fix: send failed SQL + error to LLM, replace SQL with corrected version
  const aiFixExtracted = async (sql: string, errorMsg: string, msgIndex: number, qIndex: number) => {
    const key = `${msgIndex}-${qIndex}`;
    setAiFixing(prev => ({ ...prev, [key]: true }));
    try {
      const rawSql = normalizeSQL(String(sql || ''));
      const cleanedSql = rawSql.replace(/;+\s*$/, '');
      // Capture the most recent user prompt associated with this assistant message
      let originalUserPrompt = '';
      try {
        // Prefer the immediate previous message if it's from the user
        const prevMsg = messages[msgIndex - 1];
        if (prevMsg && prevMsg.role === 'user' && typeof prevMsg.content === 'string') {
          originalUserPrompt = String(prevMsg.content || '').trim();
        } else {
          // Fallback: scan backwards to find the last user message
          for (let i = msgIndex - 1; i >= 0; i--) {
            if (messages[i]?.role === 'user') {
              originalUserPrompt = String(messages[i].content || '').trim();
              break;
            }
          }
        }
      } catch {}
      // Build prompt instructing LLM to return ONLY corrected SQL in tags
      const prompt = [
        'Fix the following SQL query for Oracle SQL (11g/12c).',
        'Return ONLY the corrected SQL wrapped between <sql start> and <sql end>.',
        'Do NOT change column names or table names. Use only the provided schema.',
        'Common Oracle fixes: COUNT(DISTINCT col) must use parentheses; replace SUBSTRING with SUBSTR; replace DATE_TRUNC with TRUNC(date_col, \"MM\"); ensure all parentheses are balanced; use LISTAGG in place of GROUP_CONCAT.',
        '',
        (originalUserPrompt ? 'Original user prompt:' : ''),
        (originalUserPrompt ? originalUserPrompt : ''),
        (originalUserPrompt ? '' : ''),
        'Original SQL:',
        '<sql start>',
        cleanedSql,
        '<sql end>',
        '',
        'Database error:',
        String(errorMsg || '')
      ].join('\n');

      // Prefer current selection; if none, infer from SQL so older queries can be fixed
      let useTables = Array.isArray(selectedTables) ? selectedTables.slice() : [];
      if (!useTables.length) {
        const inferred = extractPrimaryTableFromSQL(cleanedSql);
        if (inferred) useTables = [inferred];
      }
      if (!useTables.length) {
        throw new Error('AI Fix needs table context. Select a table or ensure the SQL mentions a table.');
      }

      await ensureApiBase();
      // Tie AI Fix to the current active conversation to avoid message leakage
      const convSnapshot = activeConvRef.current;
      const clientMsgId = uuidv4();
      const res = await fetch(`${API_BASE}/chat/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-client-id': getClientId() },
        body: JSON.stringify({ prompt, llmType, tables: useTables, trace: false, conversationId: convSnapshot || undefined, clientMessageId: clientMsgId, persist: false })
      });
      if (!res.ok) {
        let msg = '';
        try { const j = await res.json(); msg = String(j?.error || j?.details || JSON.stringify(j)); }
        catch { msg = await res.text(); }
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const data = await res.json();

      // If server generated/returned a conversationId, align local state
      try {
        const serverConvId = (data as any)?.conversationId;
        if (serverConvId && serverConvId !== activeConvRef.current) {
          setConversationId(serverConvId);
          activeConvRef.current = serverConvId;
          const oldId = convSnapshot || undefined;
          if (oldId) {
            setHistory(h => ({
              ...h,
              conversations: h.conversations.map(c => c.id === oldId ? { ...c, id: serverConvId } : c),
              lastActiveId: serverConvId,
            }));
          }
          await saveHistory({ ...history, lastActiveId: serverConvId, encrypted: false }, null);
          // Update the current page URL to reflect the server conversation id
          try {
            const url = buildConversationURL(serverConvId);
            window.history.replaceState(null, '', url);
          } catch { }
        }
      } catch { }

      // Prefer server-provided sqlQueries/sqlQuery, else extract from response
      const candidatesRaw: string[] = [
        ...(Array.isArray((data as any)?.sqlQueries) ? ((data as any).sqlQueries as string[]) : []),
        ...extractAllSQL(String((data as any)?.response || ''), (data as any)?.sqlQuery)
      ];
      const candidates = candidatesRaw.map(q => normalizeSQL(String(q || ''))).filter(Boolean);
      const origCanon = canonicalizeSQL(cleanedSql);
      const corrected = candidates.find(q => canonicalizeSQL(q) !== origCanon) || candidates[0] || '';
      if (!corrected) {
        throw new Error('AI did not return a corrected SQL');
      }

      // Replace the displayed SQL and clear previous error for this query
      setMessages(prev => prev.map((m, i) => {
        if (i !== msgIndex) return m;
        const ex = Array.isArray(m.extractedSql) ? m.extractedSql.slice() : [];
        while (ex.length <= qIndex) ex.push('');
        ex[qIndex] = corrected;
        const results = Array.isArray(m.multiResults) ? m.multiResults.slice() : [];
        while (results.length <= qIndex) results.push(null);
        results[qIndex] = null;
        return { ...m, extractedSql: ex, multiResults: results };
      }));
    } catch (e: any) {
      console.error('AI Fix failed:', e);
      // Surface AI error inline per-query (optional)
      setMessages(prev => prev.map((m, i) => {
        if (i !== msgIndex) return m;
        const errs = Array.isArray(m.multiAIError) ? m.multiAIError.slice() : [];
        while (errs.length <= qIndex) errs.push('');
        errs[qIndex] = String(e?.message || e);
        return { ...m, multiAIError: errs };
      }));
    } finally {
      setAiFixing(prev => { const next = { ...prev }; delete next[key]; return next; });
    }
  };


  // UUID v4 generator (RFC4122)
  function uuidv4(): string {
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return (
      toHex(bytes[0]) + toHex(bytes[1]) + toHex(bytes[2]) + toHex(bytes[3]) + '-' +
      toHex(bytes[4]) + toHex(bytes[5]) + '-' +
      toHex(bytes[6]) + toHex(bytes[7]) + '-' +
      toHex(bytes[8]) + toHex(bytes[9]) + '-' +
      toHex(bytes[10]) + toHex(bytes[11]) + toHex(bytes[12]) + toHex(bytes[13]) + toHex(bytes[14]) + toHex(bytes[15])
    );
  }

  // New session functionality removed per requirement



  // Execute all extracted SQL for a message, then scroll to end
  const executeAllExtracted = async (msgIndex: number, queriesOverride?: (string | any)[]) => {
    const msg = messages[msgIndex];
    const queries = (queriesOverride && Array.isArray(queriesOverride)) ? queriesOverride : (msg?.extractedSql || []);
    const allQueries = queries.map((q, qi) => ({ q, qi }));
    await Promise.all(allQueries.map(({ q, qi }) => executeExtractSQL(typeof q === 'string' ? q : String(q), msgIndex, qi)));
    setAutoScrollEnabled(false);
    setTimeout(() => {
      scrollToMultiResultsEnd(msgIndex);
      setTimeout(() => setAutoScrollEnabled(true), 300);
    }, 0);
  };

  // (Removed) Previously opened full dataset in a new window. We now use the in-app modal.

  const handleDashboardPick = async (dashboardId: string) => {
    const { type, args } = dashboardPicker;
    setDashboardPicker(prev => ({ ...prev, isOpen: false }));
    
    if (type === 'all') {
      await addAllExtractedCharts(args[0], dashboardId);
    } else if (type === 'inline') {
      await addInlineChartToDashboard(args[0], dashboardId);
    } else if (type === 'suggestion') {
      await addSuggestionChartToDashboard(args[0], args[1], args[2], args[3], dashboardId);
    } else if (type === 'multiInline') {
      await addMultiInlineChartToDashboard(args[0], args[1], args[2], args[3], dashboardId);
    }
  };

  if (!isChatOpen) return null;

  return (
    <div className={`fixed top-0 right-0 z-40 w-[480px] md:w-[540px] h-screen bg-background-light flex flex-col overflow-hidden border-l border-white/10 shadow-2xl transition-all duration-500 ${newConvEffect ? 'shadow-[0_0_40px_rgba(34,197,94,0.4)] border-green-500/40' : ''}`}>
      {newConvEffect && (
        <div className="absolute inset-0 z-[60] bg-green-500/5 pointer-events-none flex items-center justify-center animate-in fade-in duration-300">
          <div className="bg-green-500/90 backdrop-blur-md text-white px-4 py-2 rounded-full shadow-[0_0_20px_rgba(34,197,94,0.5)] animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 font-medium text-sm flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            New Conversation Created
          </div>
        </div>
      )}
      {/* Header */}
      <div className="relative z-20 flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#0d1117] backdrop-blur-md transition-all duration-300 rounded-t-xl">
        <div className="flex items-center gap-3">
           <div className={`w-2 h-2 rounded-full ${llmConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]'} transition-all duration-500`} title={llmConnected ? "Connected" : "Disconnected"}></div>
           <span className="text-sm font-semibold text-white/90 tracking-wide">Data Assistant</span>
           <div className="h-4 w-[1px] bg-white/10 mx-1"></div>
           <div className="relative group flex items-center">
              <select
                 value={llmType}
                 onChange={(e) => setLLMType(e.target.value as any)}
                 className="appearance-none bg-transparent text-[11px] font-medium text-white/60 hover:text-white uppercase tracking-wider border-none outline-none cursor-pointer transition-colors pr-4 focus:ring-0 py-0"
                 disabled={!llmConnected || availableLLMs.length === 0}
                 title="Select Model"
              >
                 {availableLLMs.length > 0 ? (
                    availableLLMs.map((m) => (
                       <option key={m} value={m} className="bg-slate-950 text-white">{m}</option>
                    ))
                 ) : (
                    <option value={llmType} className="bg-slate-950 text-white">{llmType}</option>
                 )}
              </select>
              <div className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-white/30 group-hover:text-white/70 transition-colors">
                 <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
              </div>
           </div>
        </div>

        <div className="flex items-center gap-1">
           <button 
              className="text-white/60 hover:text-white hover:bg-white/5 w-7 h-7 flex items-center justify-center rounded-lg transition-all" 
              onClick={onCreateNewConversation} 
              title="New Chat"
           >
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
           </button>
           
           {conversationId && (
              <button 
                className="text-white/60 hover:text-blue-400 hover:bg-white/5 w-7 h-7 flex items-center justify-center rounded-lg transition-all" 
                onClick={async () => {
                  try {
                    setExporting(true);
                    const payload = buildConversationExport({
                      history,
                      conversationId,
                      messages,
                      selectedTables,
                      schemaVersion,
                      llmType,
                      llmConnected,
                    });
                    const title = sanitizeFileName(payload?.meta?.title || 'conversation');
                    const ts = formatTimestamp(Date.now());
                    const fileName = `${title}-${sanitizeFileName(conversationId || 'id')}-${ts}.json`;
                    const ok = window.confirm(`Download transcript for conversation ${conversationId}?\nFile: ${fileName}`);
                    if (!ok) { setExporting(false); return; }
                    downloadJSON(payload, fileName);
                  } finally {
                    setExporting(false);
                  }
                }}
                title="Export Conversation"
                disabled={exporting}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              </button>
           )}

           <div className="relative">
              <button 
                 className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all ${isHistoryOpen ? 'text-white bg-white/10' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
                 onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                 title="History"
              >
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              </button>
              {isHistoryOpen && (
                 <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsHistoryOpen(false)}></div>
                    <div className="absolute top-full right-0 mt-2 w-72 max-h-[60vh] overflow-y-auto bg-[#0d1117] border border-white/10 rounded-xl shadow-2xl z-50 flex flex-col p-1 animate-in fade-in zoom-in-95 duration-200">
                       <div className="px-3 py-2 text-[10px] font-bold text-white/40 uppercase tracking-wider sticky top-0 bg-[#0d1117] z-10 border-b border-white/5">History</div>
                       {history.conversations.length === 0 ? (
                          <div className="px-3 py-8 text-xs text-white/40 text-center italic">No history available</div>
                       ) : (
                          <div className="p-1 space-y-0.5">
                             {history.conversations.map((c) => (
                                <div 
                                   key={c.id}
                                   className={`group/item relative w-full flex items-center px-3 py-2.5 text-xs rounded-lg hover:bg-white/5 transition-all border ${c.id === conversationId ? 'bg-blue-600/10 text-blue-200 border-blue-500/20 shadow-inner' : 'text-white/70 border-transparent'}`}
                                >
                                   <button
                                      className="flex-1 text-left min-w-0"
                                      onClick={() => {
                                         onSelectConversation(c.id);
                                         setIsHistoryOpen(false);
                                      }}
                                   >
                                      <div className={`font-medium truncate ${c.id === conversationId ? 'text-blue-100' : 'text-white/90'}`}>{c.title}</div>
                                      <div className="flex items-center justify-between mt-1">
                                         <span className="text-[10px] text-white/30 group-hover:text-white/50 transition-colors">{new Date(c.updatedAt || Date.now()).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                      </div>
                                   </button>
                                   <button
                                      className="ml-2 p-1.5 text-white/40 hover:text-red-400 rounded opacity-0 group-hover/item:opacity-100 transition-opacity z-10"
                                      onClick={(e) => {
                                         e.stopPropagation();
                                         setDeleteConfirmation(c.id);
                                         setIsHistoryOpen(false);
                                      }}
                                      title="Delete Conversation"
                                   >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                   </button>
                                   {c.id === conversationId && <div className="absolute right-2 bottom-2 w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_4px_currentColor] pointer-events-none opacity-50"></div>}
                                </div>
                             ))}
                          </div>
                       )}
                    </div>
                 </>
              )}
           </div>

           <button className="text-white/60 hover:text-white hover:bg-white/5 w-7 h-7 flex items-center justify-center rounded-lg transition-all" onClick={() => setIsConfigOpen(true)} title="Settings">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
           </button>
           <div className="h-4 w-[1px] bg-white/10 mx-1"></div>
           <button className="text-white/60 hover:text-white hover:bg-red-500/20 w-7 h-7 flex items-center justify-center rounded-lg transition-all" onClick={closeChat} title="Close">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
           </button>
        </div>
      </div>

      {/* History status banners */}
      {historyLoading && (
        <div className="flex items-center justify-center py-4 text-white/50">
          <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      )}
      {!historyLoading && historyError && (
        <div className="mt-2 p-2 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{historyError}</div>
      )}
      {/* Encryption status banner removed */}

      <div className="flex-1 overflow-auto p-2 md:p-2">
        <div className="space-y-3 md:space-y-4">
          {/* Context Switch Banner */}
          {isContextSwitchBanner && (
            <Card variant="elevated" className="p-2 border-blue-500/30 bg-blue-600/15 animate-fade-in">
              <div className="text-xs text-blue-300 font-semibold">{contextSwitchText || 'Table context updated'}</div>
            </Card>
          )}
          {/* History UI removed for stateless chat; Context Viewer removed */}
          {/* Conversation switch and error banners removed */}
          {messages.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-full min-h-[400px] px-6 animate-in fade-in duration-700">
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center mb-6 ring-1 ring-white/10 shadow-[0_0_40px_-10px_rgba(59,130,246,0.3)] backdrop-blur-xl">
                   <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-200/80"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                </div>
                <h3 className="text-xl font-semibold text-white/90 mb-2 tracking-tight">Welcome back</h3>
                <p className="text-sm text-white/40 text-center max-w-[280px] leading-relaxed mb-8">
                   Ready to analyze your data? Select a context or try a quick action below.
                </p>
                
                <div className="grid grid-cols-2 gap-3 w-full max-w-[320px]">
                   <button 
                      className="flex flex-col items-center justify-center p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all duration-300 group"
                      onClick={() => { setIsTablesOpen(true); loadTables(); }}
                   >
                      <div className="p-2 rounded-full bg-blue-500/10 text-blue-300 mb-2 group-hover:scale-110 transition-transform">
                         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
                      </div>
                      <span className="text-xs font-medium text-white/70 group-hover:text-white">List Tables</span>
                   </button>
                   
                   <button 
                      className="flex flex-col items-center justify-center p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all duration-300 group"
                      onClick={() => setAnalysisEnabled(true)}
                   >
                      <div className="p-2 rounded-full bg-purple-500/10 text-purple-300 mb-2 group-hover:scale-110 transition-transform">
                         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18M18 17l-5-5-4 4-4-4"/></svg>
                      </div>
                      <span className="text-xs font-medium text-white/70 group-hover:text-white">Enable Analysis</span>
                   </button>
                </div>
             </div>
          ) : (
            messages.map((msg, idx) => (
            <div key={(msg as any).id ?? (msg as any).ts ?? idx} className={`group/msg relative ${msg.role === 'user' ? 'flex justify-end pl-12' : 'flex justify-start pr-8'} mb-4 animate-in fade-in slide-in-from-bottom-2 duration-500`}>
              <div
                className={`relative max-w-full md:max-w-[85%] transition-all duration-300 ${
                  msg.role === 'user' 
                    ? 'bg-white/5 border border-white/10 text-white/90 shadow-sm backdrop-blur-md rounded-2xl rounded-tr-sm px-4 py-2.5' 
                    : 'bg-transparent pl-2 border-l-2 border-white/5 hover:border-blue-500/50'
                }`}
              >
                <div className="p-0 relative">
                  {/* Action Buttons - Positioned top-right inside the bubble for Assistant, or left side for User */}
                  <div className={`flex items-center gap-1 absolute ${msg.role === 'user' ? 'top-1/2 -left-20 -translate-y-1/2 justify-end w-16' : '-top-2 right-0'} opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200 bg-slate-900/80 backdrop-blur-sm rounded-full p-1 border border-white/10 shadow-lg z-10`}>
                    {msg.role === 'assistant' && (
                        <>
                           <button 
                              className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                              onClick={() => navigator.clipboard.writeText(msg.content)}
                              title="Copy"
                           >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                           </button>
                           <button 
                              className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                              onClick={() => { /* Regenerate logic */ }}
                              title="Regenerate"
                           >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
                           </button>
                        </>
                    )}
                    {msg.role === 'user' && (
                        <button 
                           className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                           onClick={() => navigator.clipboard.writeText(msg.content)}
                           title="Copy"
                        >
                           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                    )}
                    {msg.role === 'assistant' && (msg as any).debugTrace && (
                      <button className="p-1.5 text-white/40 hover:text-blue-400 hover:bg-blue-400/10 rounded-full transition-colors" title="Show Trace" onClick={() => onToggleTrace(idx)}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                      </button>
                    )}
                  </div>

                  {!!msg.content && (
                    <div className={`${msg.role === 'assistant' ? '' : ''}`}>
                      {msg.role === 'assistant' ? (
                        <StructuredAssistantText raw={normalizeLLMResponse(msg.content)} />
                      ) : (
                        <div className="text-white/90 text-sm leading-relaxed font-normal tracking-wide">{msg.content}</div>
                      )}
                    </div>
                  )}
                  {(msg as any).debugTrace && msg.showTrace && (
                    <div className="mt-2 rounded-md border border-white/15 bg-background/80 p-2">
                      <div className="text-[11px] text-white/70">LLM Trace</div>
                      <div className="text-[10px] text-white/60">Provider: {(msg as any).debugTrace?.provider} · Model: {(msg as any).debugTrace?.model}</div>
                      {(() => {
                        const sys = (msg as any).debugTrace?.request?.messages?.[0]?.content || '';
                        const usr = (msg as any).debugTrace?.request?.messages?.[1]?.content || '';
                        const endpoint = (msg as any).debugTrace?.request?.endpoint || '';
                        return (
                          <div className="mt-1 space-y-1">
                            {!!endpoint && <div className="text-[10px] text-white/50">Endpoint: {endpoint}</div>}
                            <div className="text-[10px] text-white/60">System Prompt</div>
                            <pre className="p-2 text-[11px] overflow-x-auto rounded-md border border-white/10 bg-background/90">{String(sys)}</pre>
                            <div className="text-[10px] text-white/60">User Prompt</div>
                            <pre className="p-2 text-[11px] overflow-x-auto rounded-md border border-white/10 bg-background/90">{String(usr)}</pre>
                            <div className="text-[10px] text-white/60">AI Response</div>
                            <pre className="p-2 text-[11px] overflow-x-auto rounded-md border border-white/10 bg-background/90">{normalizeLLMResponse((msg as any).debugTrace?.response?.text)}</pre>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  {/* Removed separate single SQL block to unify all queries under Extracted SQL */}
                  {/* When a single SQL was executed (e.g., after saving a chart), conditionally show SQL: show for normal prompts regardless of extracted queries presence */}
                  {(msg.result && !(msg.result as any)?.error && Array.isArray((msg.result as any)?.rows) && (msg.result as any).rows.length > 0) && (
                    <div className="mt-1 p-1 pt-0">
                      {!!(msg as any).executedSql && !((msg as any).chartRequested) && (
                        <div className="mb-1">
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-[11px] text-white/60">Executed SQL</div>
                            <div className="flex items-center gap-1">
                              <button
                                className="flex items-center justify-center w-6 h-6 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                                aria-label="Copy SQL"
                                title="Copy SQL"
                                onClick={() => navigator.clipboard.writeText(String((msg as any).executedSql || ''))}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                              </button>
                            </div>
                          </div>
                          <pre className="p-1 text-[11px] md:text-[12px] overflow-auto whitespace-pre-wrap rounded-md bg-background/80 border border-white/10">{String((msg as any).executedSql || '')}</pre>
                        </div>
                      )}
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[11px] font-medium text-blue-200/80 flex items-center gap-1.5">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><rect x="7" y="10" width="5" height="4"/><rect x="15" y="5" width="5" height="9"/><rect x="7" y="17" width="5" height="4"/><rect x="15" y="17" width="5" height="4"/></svg>
                          Result Preview
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-600/20 hover:bg-blue-600/30 text-blue-200 text-[11px] border border-blue-500/30 transition-all hover:border-blue-500/50 shadow-sm"
                            title="Open full data analysis"
                            onClick={() => { setFullDataSql(String((msg as any).executedSql || '')); setFullDataOpen(true); }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                            Data Analysis
                          </button>
                        </div>
                      </div>
                      <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-900/50 shadow-inner">
                        <div className="overflow-x-auto overflow-y-auto max-h-[60vh] w-full scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                          <table className="min-w-[150%] text-[12px] w-full border-collapse">
                            <thead>
                              <tr className="bg-white/5 sticky top-0 z-10 backdrop-blur-sm">
                                {Object.keys((msg.result as any).rows[0]).map((col) => (
                                  <th key={col} className="text-left px-4 py-2.5 border-b border-white/10 text-white/70 font-medium whitespace-nowrap">
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(msg.result as any).rows.map((row: any, rIdx: number) => (
                                <tr key={rIdx} className="group hover:bg-white/5 transition-colors border-b border-white/5 last:border-0">
                                  {Object.keys(row).map((col) => (
                                    <td key={col} className="px-4 py-2 text-white/80 group-hover:text-white whitespace-nowrap">{formatCell(row[col])}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      {(() => {
                        const inlineChart = (msg as any).inlineChart || null;
                        if (inlineChart) {
                          return (
                            <div className="mt-3">
                              <div className="flex items-center justify-between mb-1">
                                <div className="text-[11px] text-white/60">Requested Visualization</div>
                                <div className="flex items-center gap-1">
                                  <button
                                    className="btn btn-outline btn-xs px-2 py-1 h-7 gap-1.5"
                                    title={activeDashboardId ? "Add chart to dashboard" : "Select a dashboard to enable"}
                                    disabled={!activeDashboardId || !!savingSingle[idx]}
                                    onClick={() => setDashboardPicker({ isOpen: true, type: 'inline', args: [idx] })}
                                  >
                                    {savingSingle[idx] ? (
                                      <span className="inline-block w-3 h-3 rounded-full bg-white/60 animate-bounce" />
                                    ) : (
                                      <>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                                        <span>Add</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>
                              <div className={`rounded-md border ${suggestionAccent(inlineChart.type)} p-1`}>
                                <ChartRenderer
                                  title={inlineChart.title}
                                  type={inlineChart.type}
                                  config={inlineChart.config}
                                  data={(msg.result as any)}
                                  responsive
                                  minHeight={240}
                                  maxHeight={420}
                                  sourceQuery={String(((msg as any).executedSql || ''))}
                                />
                              </div>
                              {!!saveError[`single-${idx}`] && (
                                <div className="mt-1 text-[11px] text-red-400">{saveError[`single-${idx}`]}</div>
                              )}
                            </div>
                          );
                        }
                        const err = (msg as any).aiError || '';
                        if ((msg as any).chartRequested && err) {
                          return (<div className="mt-2 text-red-400 text-[12px]">{String(err)}</div>);
                        }
                        // Show auto visualizations when Analysis is enabled and no chart was requested
                        const colsRaw = Array.isArray((msg.result as any)?.columns) && (((msg.result as any).columns as any[]).length > 0)
                          ? ((msg.result as any).columns as any[])
                          : (((msg.result as any).rows?.length ? Object.keys((msg.result as any).rows[0]) : []));
                        let suggestions = Array.isArray((msg as any).aiSuggestions) ? ((msg as any).aiSuggestions || []) : [];
                        const limit = recommendedChartLimit(colsRaw || [], (msg as any).result?.rows || [], Array.isArray(suggestions) ? suggestions.length : 0);
                        suggestions = Array.isArray(suggestions) ? suggestions.slice(0, limit) : [];
                        return ((!((msg as any).chartRequested) && analysisEnabled) && Array.isArray(suggestions) && suggestions.length) ? (
                          <div className="mt-3">
                            <div className="text-[11px] text-white/60 mb-1">Auto Visualizations</div>
                            <div className="grid grid-cols-1 gap-4">
                              {suggestions.map((s: any, si: number) => (
                                <div key={si} className={`rounded-md border ${suggestionAccent(s.type)} p-2`}>
                                  <ChartRenderer
                                    title={s.title}
                                    type={s.type}
                                    config={s.config}
                                    data={s.data}
                                    responsive
                                    minHeight={200}
                                    maxHeight={300}
                                    sourceQuery={String(((msg as any).executedSql || ''))}
                                  />
                                  {!!s.validation && s.validation.valid && (
                                    <div className="mt-1 text-[10px] text-green-300">✓ Validated</div>
                                  )}
                                  {!!saveError[`suggest-${idx}-${si}`] && (
                                    <div className="mt-1 text-[11px] text-red-400">{saveError[`suggest-${idx}-${si}`]}</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null;
                      })()}
                    </div>
                  )}
                  {(!msg.hideSql) && msg.showExtracted && Array.isArray(msg.extractedSql) && msg.extractedSql.length > 0 && (
                    <div className="mt-4 rounded-xl border border-white/10 bg-[#0d1117] shadow-lg overflow-hidden">
                      <div className="flex justify-between items-center px-3 py-2 bg-white/5 border-b border-white/5">
                        <div className="flex items-center gap-2">
                           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400"><path d="m5 8 5-5 5 5"/><path d="M12 13V3"/><path d="M20 13a9 9 0 0 1-6 8.3 11.5 11.5 0 0 1-4 0 9 9 0 0 1-6-8.3"/><path d="M4 19h16"/></svg>
                           <span className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">Extracted SQL</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button className="btn btn-primary btn-xs px-2 py-1 h-7 gap-1.5 shadow-sm hover:shadow transition-all" title="Run all extracted queries" onClick={() => executeAllExtracted(idx)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            Run All
                          </button>
                          <button
                            className="btn btn-outline btn-xs px-2 py-1 h-7 gap-1.5"
                            title={activeDashboardId ? "Add all charts to dashboard" : "Select a dashboard to enable"}
                            disabled={!activeDashboardId || !!savingBatch[idx]}
                            onClick={() => setDashboardPicker({ isOpen: true, type: 'all', args: [idx] })}
                          >
                            {savingBatch[idx] ? (
                              <span className="inline-block w-3 h-3 rounded-full bg-white/60 animate-bounce" />
                            ) : (
                              <>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                                <span>Add All</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                      {!!batchError[idx] && (
                        <div className="text-[11px] text-red-400 mt-1 px-1">{batchError[idx]}</div>
                      )}
                      {(() => {
                        const arr = Array.isArray(msg.extractedSql) ? msg.extractedSql : [];
                        return (
                          <div className="space-y-6 p-4">
                            {arr.map((fq: any, i: number) => {
                              const sqlText = typeof fq === 'string' ? fq : safeStringify(fq, 2);
                              const res = Array.isArray(msg.multiResults) ? (msg.multiResults[i] || null) : null;
                              return (
                                <div key={`extracted-${idx}-${i}`} className="rounded-lg border border-white/10 bg-[#0d1117] overflow-hidden group/query">
                                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-white/[0.02]">
                                    <div className="text-[10px] font-mono text-white/40">Query {i + 1}</div>
                                    <div className="flex items-center gap-1">
                                      <button
                                        className="flex items-center justify-center w-6 h-6 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                                        aria-label="Copy SQL"
                                        title="Copy SQL"
                                        onClick={() => navigator.clipboard.writeText(String(sqlText))}
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                        </svg>
                                      </button>
                                      <button
                                        className="btn btn-primary btn-xs h-6 px-2 min-h-0 gap-1 text-[10px] shadow-sm hover:shadow transition-all"
                                        aria-label="Run this query"
                                        title="Run this query"
                                        onClick={() => executeExtractSQL(sqlText, idx, i)}
                                      >
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                        Run
                                      </button>
                                    </div>
                                  </div>
                                  <pre className="p-3 text-[11px] font-mono text-blue-100/90 leading-relaxed overflow-auto whitespace-pre-wrap scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent max-h-[300px]">{sqlText}</pre>
                                  {res && (res as any)?.error && (
                                    <div className="px-2 py-1 text-red-400 text-[11px] border-t border-red-500/20 bg-red-500/5 flex items-center justify-between">
                                      <span className="truncate mr-2">{(res as any).error}</span>
                                      <button
                                        className="btn btn-ghost btn-xs px-1 py-0.5"
                                        title={llmConfigured ? 'AI Fix SQL' : 'Configure AI to use Fix'}
                                        aria-label="AI Fix SQL"
                                        disabled={!llmConfigured || !!aiFixing[`${idx}-${i}`]}
                                        onClick={() => {
                                          const errText = String(((res as any)?.details && (res as any).details.message) || (res as any)?.error || '');
                                          const details = (res as any)?.details ? safeStringify((res as any).details, 2) : '';
                                          const code = (res as any)?.code ? String((res as any).code) : '';
                                          const composite = [
                                            errText,
                                            (code ? `\nError code: ${code}` : ''),
                                            (details ? `\nError details:\n${details}` : ''),
                                          ].join('');
                                          aiFixExtracted(sqlText, composite, idx, i);
                                        }}
                                      >
                                        {aiFixing[`${idx}-${i}`] ? (
                                          <span className="inline-block w-3 h-3 rounded-full bg-white/60 animate-bounce" />
                                        ) : (
                                          <span>🤖 Fix</span>
                                        )}
                                      </button>
                                    </div>
                                  )}
                                  {res && !(res as any)?.error && Array.isArray((res as any)?.rows) && (res as any).rows.length > 0 && (
                                    <div className="mt-2 p-2 pt-0">
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="text-[11px] font-medium text-blue-200/80 flex items-center gap-1.5">
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><rect x="7" y="10" width="5" height="4"/><rect x="15" y="5" width="5" height="9"/><rect x="7" y="17" width="5" height="4"/><rect x="15" y="17" width="5" height="4"/></svg>
                                          Result Preview
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <button
                                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-600/20 hover:bg-blue-600/30 text-blue-200 text-[11px] border border-blue-500/30 transition-all hover:border-blue-500/50 shadow-sm"
                                            title="Open full data analysis"
                                            onClick={() => { setFullDataSql(String(sqlText)); setFullDataOpen(true); }}
                                          >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                                            Data Analysis
                                          </button>
                                          {/* AI Visualization removed */}
                                        </div>
                                      </div>
                                      <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-900/50 shadow-inner">
                                        <div className="overflow-x-auto overflow-y-auto max-h-[35vh] w-full scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                                          <table className="min-w-max text-[11px] w-full border-collapse">
                                            <thead>
                                              <tr className="bg-white/5 sticky top-0 z-10 backdrop-blur-sm">
                                                {Object.keys((res as any).rows[0]).map((col) => (
                                                  <th key={col} className="text-left px-3 py-2 border-b border-white/10 text-white/70 font-medium whitespace-nowrap">
                                                    {col}
                                                  </th>
                                                ))}
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {(res as any).rows.map((row: any, rIdx: number) => (
                                                <tr key={rIdx} className="group hover:bg-white/5 transition-colors border-b border-white/5 last:border-0">
                                                  {Object.keys(row).map((col) => (
                                                    <td key={col} className="px-3 py-1.5 text-white/80 group-hover:text-white whitespace-nowrap">{formatCell(row[col])}</td>
                                                  ))}
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                      {(() => {
                                        const colsRaw = Array.isArray((res as any)?.columns) && ((res as any).columns as any[]).length
                                          ? ((res as any).columns as any[])
                                          : ((res as any).rows?.length ? Object.keys((res as any).rows[0]) : []);
                                        
                                        const inlineRaw = Array.isArray((msg as any).multiInlineChart) ? ((msg as any).multiInlineChart[i] || null) : null;
                                        const inlineCharts = Array.isArray(inlineRaw) ? inlineRaw : (inlineRaw ? [inlineRaw] : []);

                                        if (inlineCharts.length > 0) {
                                          return (
                                            <>
                                            {inlineCharts.map((inlineChart: any, chartIdx: number) => (
                                            <div className="mt-3" key={chartIdx}>
                                              <div className="flex items-center justify-between mb-1">
                                                <div className="text-[11px] text-white/60">Requested Visualization {inlineCharts.length > 1 ? `#${chartIdx + 1}` : ''}</div>
                                                <div className="flex items-center gap-1">
                                                  <button
                                                    className="btn btn-outline btn-xs px-1 py-0.5"
                                                    title={activeDashboardId ? "Add chart to dashboard" : "Select a dashboard to enable"}
                                                    disabled={!activeDashboardId || !!savingSuggestion[`inline-${idx}-${i}-${chartIdx}`]}
                                                    onClick={() => setDashboardPicker({ isOpen: true, type: 'multiInline', args: [idx, i, String(sqlText || ''), chartIdx] })}
                                                  >
                                                    {savingSuggestion[`inline-${idx}-${i}-${chartIdx}`] ? (
                                                      <span className="inline-block w-3 h-3 rounded-full bg-white/60 animate-bounce" />
                                                    ) : (
                                                      <span className="flex items-center gap-1">
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                                          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                                        </svg>
                                                        <span>Add</span>
                                                      </span>
                                                    )}
                                                  </button>
                                                </div>
                                              </div>
                                              <div className={`rounded-md border ${suggestionAccent(inlineChart.type)} p-1`}>
                                                <ChartRenderer
                                                  title={inlineChart.title}
                                                  type={inlineChart.type}
                                                  config={inlineChart.config}
                                                  data={res as any}
                                                  responsive
                                                  minHeight={240}
                                                  maxHeight={420}
                                                  sourceQuery={String(sqlText || '')}
                                                />
                                              </div>
                                              {!!saveError[`inline-${idx}-${i}-${chartIdx}`] && (
                                                <div className="mt-1 text-[11px] text-red-400">{saveError[`inline-${idx}-${i}-${chartIdx}`]}</div>
                                              )}
                                            </div>
                                            ))}
                                            </>
                                          );
                                        }
                                        // If chart was explicitly requested but could not be rendered, surface the error
                                        const err = Array.isArray((msg as any).multiAIError) ? ((msg as any).multiAIError[i] || '') : '';
                                        if ((msg as any).chartRequested && err) {
                                          return (<div className="mt-2 text-red-400 text-[12px]">{String(err)}</div>);
                                        }
                                        // Show auto visualizations when Analysis is enabled and no chart was requested
                                        let suggestions = Array.isArray((msg as any).multiAISuggestions) ? ((msg as any).multiAISuggestions[i] || []) : [];
                                        const limit = recommendedChartLimit(colsRaw || [], (res as any).rows || [], Array.isArray(suggestions) ? suggestions.length : 0);
                                        suggestions = Array.isArray(suggestions) ? suggestions.slice(0, limit) : [];
                                        return ((!((msg as any).chartRequested) && analysisEnabled) && Array.isArray(suggestions) && suggestions.length) ? (
                                          <div className="mt-3">
                                            <div className="text-[11px] text-white/60 mb-1">Auto Visualizations</div>
                                            <div className="grid grid-cols-1 gap-4">
                                              {suggestions.map((s: any, si: number) => (
                                                <div key={si} className={`rounded-md border ${suggestionAccent(s.type)} p-2`}>
                                                  <ChartRenderer
                                                    title={s.title}
                                                    type={s.type}
                                                    config={s.config}
                                                    data={s.data}
                                                    responsive
                                                    minHeight={200}
                                                    maxHeight={300}
                                                    sourceQuery={String(sqlText || '')}
                                                  />
                                                  {!!s.validation && s.validation.valid && (
                                                    <div className="mt-1 text-[10px] text-green-300">✓ Validated</div>
                                                  )}
                                                  {!!saveError[`suggest-${idx}-${si}`] && (
                                                    <div className="mt-1 text-[11px] text-red-400">{saveError[`suggest-${idx}-${si}`]}</div>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        ) : null;
                                      })()}
                                    </div>
                                  )}
                                  {res && !(res as any)?.error && Array.isArray((res as any)?.columns) && ((res as any).columns as any[]).length > 0 && (!(res as any).rows || (res as any).rows.length === 0) && (
                                    <div className="mt-2 p-2 pt-0">
                                      <div className="text-[11px] text-white/60 mb-1">Result Preview:</div>
                                      <div className="overflow-x-auto overflow-y-auto max-h-[35vh] w-full">
                                        <table className="min-w-max text-[11px]">
                                          <thead>
                                            <tr>
                                              {(((res as any).columns as any[]) || []).map((col: any) => (
                                                <th key={String(col)} className="text-left px-2 py-1 border-b border-white/10 text-white/70">
                                                  {typeof col === 'string' ? col : String(col?.name ?? col ?? '')}
                                                </th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody>
                                            <tr className="odd:bg-background">
                                              <td className="px-2 py-1 border-b border-white/5 text-white/50" colSpan={(((res as any).columns as any[]) || []).length}>No rows returned</td>
                                            </tr>
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                      <div ref={el => { if (el) multiResultEndRefs.current[idx] = el; }} />
                    </div>
                  )}
                  {/* Removed SQL-only retry banner to restore raw LLM behavior */}
                </div>
              </div>
            </div>
          )))}
          {/* SQL Preview Modal */}
          {preview && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/50" onClick={() => setPreview(null)}></div>
              <div className="relative w-[92vw] sm:w-[80vw] md:w-[700px] max-h-[80vh] rounded-xl border border-white/15 bg-slate-900/90 backdrop-blur-md shadow-lg">
                <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                  <div className="text-sm text-white/80">SQL Preview</div>
                  <button className="btn btn-ghost text-xs" onClick={() => setPreview(null)}>Close</button>
                </div>
                <div className="p-3 overflow-auto">
                  <pre className="p-3 rounded-lg bg-background/70 border border-white/10 text-[12px] md:text-[13px] overflow-auto whitespace-pre-wrap">{typeof preview.sql === 'string' ? preview.sql : safeStringify(preview.sql, 2)}</pre>
                </div>
                <div className="px-4 py-3 border-t border-white/10 flex items-center justify-end gap-2">
                  <button className="btn btn-outline btn-sm" onClick={() => navigator.clipboard.writeText(String(preview.sql))}>Copy</button>
                  <button className="btn btn-primary btn-sm" onClick={() => { if (preview.mode === 'extracted' && typeof preview.qIndex === 'number') { executeExtractSQL(preview.sql, preview.index ?? messages.length - 1, preview.qIndex); } else { executeSQL(preview.sql, preview.index ?? messages.length - 1); } setPreview(null); }}>Run</button>
                </div>
              </div>
            </div>
          )}
          {loading && (
            <div className="flex items-center gap-3 px-4 py-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="relative flex items-center gap-1">
                 <div className="w-1.5 h-1.5 rounded-full bg-blue-400/60 animate-[bounce_1s_infinite_-0.3s]"></div>
                 <div className="w-1.5 h-1.5 rounded-full bg-blue-400/60 animate-[bounce_1s_infinite_-0.15s]"></div>
                 <div className="w-1.5 h-1.5 rounded-full bg-blue-400/60 animate-[bounce_1s_infinite]"></div>
                 <div className="absolute inset-0 blur-sm bg-blue-500/20 -z-10"></div>
              </div>
              <span className="text-xs font-medium text-blue-300/50 tracking-wide animate-pulse">Thinking...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="p-4 bg-transparent relative z-30">
        {/* Floating Input Capsule */}
        <div className="relative bg-black/60 backdrop-blur-2xl rounded-3xl border border-white/10 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.5)] ring-1 ring-white/5 transition-all duration-300 focus-within:ring-blue-500/50 focus-within:border-blue-500/50 focus-within:bg-black/80 group/capsule">
          
          {/* Text Input */}
          <div className="relative px-4 pt-4 pb-12">
             <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && onSend()}
                placeholder="Ask anything..."
                className="w-full bg-transparent border-none outline-none text-[15px] text-white/90 placeholder:text-white/30 min-h-[24px] max-h-[200px] resize-none leading-relaxed tracking-wide selection:bg-blue-500/30"
                disabled={loading || !llmConfigured}
                rows={1}
                style={{ height: 'auto' }}
                onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = 'auto';
                    target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                }}
             />
          </div>

          {/* Bottom Actions Row */}
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between px-2">
             {/* Tools (Left) */}
             <div className="flex items-center gap-1">
                <button 
                   className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-200 ${selectedTables.length ? 'bg-blue-500/20 text-blue-200 border border-blue-500/20' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80 border border-transparent'}`}
                   onClick={() => { setIsTablesOpen(v => !v); if (!isTablesOpen && tables.length === 0) loadTables(); }}
                   title="Manage Context"
                >
                   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
                   <span>{selectedTables.length > 0 ? `${selectedTables.length} Context` : 'Context'}</span>
                </button>
                
                <button
                   className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-200 ${analysisEnabled ? 'bg-purple-500/20 text-purple-200 border border-purple-500/20' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80 border border-transparent'}`}
                   onClick={() => setAnalysisEnabled(v => !v)}
                   title="Toggle Analysis"
                >
                   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18M18 17l-5-5-4 4-4-4"/></svg>
                   <span>Analysis</span>
                </button>
             </div>

             {/* Send Button (Right) */}
             <div className="flex items-center gap-3">
                <div className={`w-1.5 h-1.5 rounded-full ${llmConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-red-500'} transition-colors`} title={llmConnected ? "Online" : "Offline"}></div>
                <button
                  className={`p-2 rounded-xl transition-all duration-300 ${input.trim() ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)] hover:bg-blue-500 transform hover:scale-105' : 'bg-white/5 text-white/20 cursor-not-allowed'}`}
                  onClick={() => onSend()}
                  disabled={!input.trim() || !llmConfigured || loading}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={loading ? "animate-spin" : ""}><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                </button>
             </div>
          </div>
        </div>
        
        {/* Tables Panel (Floating) */}
        {isTablesOpen && (
           <div className="absolute bottom-full left-4 right-4 mb-3 p-4 rounded-2xl bg-slate-900/90 backdrop-blur-xl border border-white/10 shadow-[0_-8px_30px_rgba(0,0,0,0.5)] flex flex-col animate-in slide-in-from-bottom-4 zoom-in-95 duration-300 ease-out max-h-[450px] z-40">
              <div className="flex items-center justify-between mb-4">
                 <h3 className="text-sm font-medium text-white/90 flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
                    Context Manager
                 </h3>
                 <button 
                    className="text-white/40 hover:text-white transition-colors"
                    onClick={() => setIsTablesOpen(false)}
                 >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                 </button>
              </div>

              <div className="relative mb-3 group">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 group-focus-within:text-blue-400 transition-colors"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                 <input
                    value={tableFilter}
                    onChange={(e) => setTableFilter(e.target.value)}
                    placeholder="Filter tables..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all"
                 />
              </div>

              {!!schemaError && (
                 <div className="mb-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-200 text-xs flex items-start gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    {schemaError}
                 </div>
              )}
              
              {!!failedTables.length && (
                 <div className="mb-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs">
                    Failed to load: {failedTables.join(', ')}
                 </div>
              )}

              <div className="overflow-y-auto flex-1 pr-1 -mr-1 custom-scrollbar">
                {tablesError ? (
                  <div className="p-4 text-center text-red-300 text-xs border border-dashed border-red-500/20 rounded-lg">{tablesError}</div>
                ) : (
                  <div className="space-y-1">
                     {filteredTables.length === 0 && (
                        <div className="text-center py-8 text-white/20 text-xs">No tables found</div>
                     )}
                     {filteredTables.map((t) => (
                        <label key={t.name} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 cursor-pointer group transition-colors border border-transparent hover:border-white/5">
                           <div className="flex items-center gap-3">
                              <div className={`w-4 h-4 rounded flex items-center justify-center transition-all ${selectedTables.includes(t.name) ? 'bg-blue-500 text-white' : 'bg-white/10 text-transparent group-hover:bg-white/20'}`}>
                                 <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              </div>
                              <span className={`text-xs transition-colors ${selectedTables.includes(t.name) ? 'text-white font-medium' : 'text-white/60 group-hover:text-white/90'}`}>{t.name}</span>
                           </div>
                           <input
                              type="checkbox"
                              className="hidden"
                              checked={selectedTables.includes(t.name)}
                              onChange={(e) => {
                                 setSelectedTables(prev => e.target.checked ? [...prev, t.name] : prev.filter(x => x !== t.name));
                              }}
                           />
                        </label>
                     ))}
                  </div>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                 <span className="text-[10px] text-white/30">{selectedTables.length} selected</span>
                 <button 
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1.5 ${isSchemaOpen ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'bg-white/5 text-white/60 hover:bg-white/10 border border-white/5'}`}
                    onClick={() => {
                       if (!isSchemaOpen) loadSelectedSchema();
                       setIsSchemaOpen(!isSchemaOpen);
                    }}
                 >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    {isSchemaOpen ? 'Hide Schema' : 'View Schema'}
                 </button>
              </div>
              
              {/* Selected tables schema overview */}
              {isSchemaOpen && schemaTables && schemaTables.length > 0 && (
                <div className="absolute inset-0 z-50 bg-slate-900 rounded-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-slate-900 sticky top-0 z-10">
                     <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white/90">Schema Details</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">{schemaTables.length} tables</span>
                     </div>
                     <button onClick={() => setIsSchemaOpen(false)} className="text-white/40 hover:text-white transition-colors flex items-center gap-1 text-[10px] uppercase font-medium tracking-wider bg-white/5 hover:bg-white/10 px-2 py-1 rounded-md">
                        Close <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                     </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                    {schemaTables.map((tbl) => (
                      <div key={tbl.name} className="group bg-white/5 rounded-lg border border-white/5 p-3 hover:border-white/10 transition-colors">
                        <div className="flex items-center gap-2 text-xs text-blue-300 font-medium mb-2">
                           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18M18 17l-5-5-4 4-4-4"/></svg>
                           {tbl.name}
                        </div>
                        <div className="pl-1">
                          {(tbl.columns || []).length === 0 ? (
                            <div className="text-[10px] text-white/30 italic">No columns loaded</div>
                          ) : (
                            <div className="grid grid-cols-1 gap-1">
                              {tbl.columns.map((c) => (
                                <div key={`${tbl.name}.${c.column_name}`} className="text-[10px] flex items-center justify-between py-1 px-2 rounded hover:bg-white/5 border border-transparent hover:border-white/5 transition-colors">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-white/80 font-mono truncate">{c.column_name}</span>
                                    {c.is_primary_key ? <span className="px-1 rounded-[2px] bg-amber-500/20 text-amber-300 text-[8px] font-bold shrink-0">PK</span> : null}
                                    {c.is_foreign_key ? <span className="px-1 rounded-[2px] bg-purple-500/20 text-purple-300 text-[8px] font-bold shrink-0" title={`FK -> ${c.referenced_table}.${c.referenced_column}`}>FK</span> : null}
                                  </div>
                                  <span className="text-white/30 text-[9px] font-mono shrink-0 ml-2">{c.data_type}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
           </div>
        )}
      </div>

      <LLMConfigModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        onConfigured={() => {
          // Keep existing conversation; only refresh LLM status
          loadLLMStatus();
        }}
      />

      <PassphraseModal
        isOpen={isPassphraseOpen}
        onClose={() => setIsPassphraseOpen(false)}
        onSet={(p) => setPassphrase(p)}
      />

      {/* Bind variables modal removed */}
        <FullDataModal isOpen={fullDataOpen} sql={fullDataSql} onClose={() => setFullDataOpen(false)} disableSave={false} />
      <ChartBuilderModal
        isOpen={chartBuilderOpen}
        onClose={() => { setChartBuilderOpen(false); setChartBuilderData(null); }}
        dataOverride={chartBuilderData || undefined}
        disableSave={true}
      />
      {/* AI Visualization modal removed */}

      {/* Delete Confirmation Modal */}
      {deleteConfirmation && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-white/10 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-white/5">
              <h3 className="text-lg font-medium text-white">Delete Conversation</h3>
            </div>
            <div className="p-4">
              <p className="text-sm text-white/70">Are you sure you want to delete this conversation? This action cannot be undone.</p>
            </div>
            <div className="flex items-center justify-end gap-2 p-4 bg-white/5">
              <button 
                className="btn btn-ghost btn-sm text-white/70 hover:text-white" 
                onClick={() => setDeleteConfirmation(null)}
              >
                Cancel
              </button>
              <button 
                className="btn btn-error btn-sm bg-red-500/20 text-red-200 hover:bg-red-500/30 border-red-500/30" 
                onClick={() => {
                  if (deleteConfirmation) onDeleteConversation(deleteConfirmation);
                  setDeleteConfirmation(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dashboard Picker Modal */}
      <DashboardPickerModal
        isOpen={dashboardPicker.isOpen}
        onClose={() => setDashboardPicker(prev => ({ ...prev, isOpen: false }))}
        onPick={handleDashboardPick}
        dashboards={dashboards}
        initialDashboardId={activeDashboardId || ''}
      />
    </div>
  );
}

// Safe JSON stringify with cycle handling and special cases
function safeStringify(val: any, space = 0): string {
  try {
    const seen = new WeakSet();
    return JSON.stringify(val, (key, value) => {
      if (typeof value === 'bigint') return String(value);
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        if ((value as any)?.type === 'Buffer' && Array.isArray((value as any)?.data)) {
          return `[Buffer (${(value as any).data.length} bytes)]`;
        }
      }
      return value;
    }, space);
  } catch {
    const name = (val && (val as any).constructor && (val as any).constructor.name) ? (val as any).constructor.name : 'Object';
    const keys = Object.keys(val || {});
    return `[${name}${keys.length ? ` keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', …' : ''}` : ''}]`;
  }
}

// Build a complete snapshot of the active conversation with UI extras
function buildConversationExport(opts: {
  history: ConversationHistory;
  conversationId: string | null;
  messages: ChatMessage[];
  selectedTables: string[];
  schemaVersion: number;
  llmType: string;
  llmConnected: boolean;
}): any {
  const { history, conversationId, messages, selectedTables, schemaVersion, llmType, llmConnected } = opts;
  const conv = conversationId ? history.conversations.find(c => c.id === conversationId) : null;
  const meta = conv ? {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  } : {
    id: conversationId,
    title: 'Chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // Include both live UI messages (with results) and the persisted copy
  const snapshot = {
    version: 1,
    exportedAt: Date.now(),
    meta,
    llm: { type: llmType, connected: !!llmConnected },
    context: {
      selectedTables: Array.from(new Set(selectedTables || [])).filter(Boolean),
      schemaVersion: schemaVersion || 0,
    },
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
      ts: m.ts,
      sql: m.sql,
      extractedSql: Array.isArray(m.extractedSql) ? m.extractedSql : [],
      showExtracted: !!m.showExtracted,
      hideSql: !!m.hideSql,
      tablesContext: Array.isArray(m.tablesContext) ? m.tablesContext : [],
      result: m.result ? m.result : null,
      multiResults: Array.isArray(m.multiResults) ? m.multiResults : [],
      aiSuggestions: Array.isArray(m.aiSuggestions) ? m.aiSuggestions : [],
      multiAISuggestions: Array.isArray(m.multiAISuggestions) ? m.multiAISuggestions : [],
      aiError: m.aiError || undefined,
      multiAIError: Array.isArray(m.multiAIError) ? m.multiAIError : [],
      debugTrace: m.debugTrace || undefined,
      sender: m.role === 'assistant' ? 'AI Assistant' : 'User',
    })),
    validation: {
      conversationId,
      messagesCount: messages.length,
      onlyCurrentConversation: true,
    },
    persisted: conv ? {
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messages: Array.isArray(conv.messages) ? conv.messages : [],
    } : null,
  };
  return snapshot;
}

function sanitizeFileName(name: string): string {
  return String(name || '')
    .replace(/[^A-Za-z0-9_\- ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'conversation';
}

function downloadJSON(data: any, fileName: string): void {
  try {
    const json = safeStringify(data, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error('Download failed:', e);
  }
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Normalize varied LLM response shapes into a user-displayable string
function normalizeLLMResponse(raw: any): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    // Join array items, extracting text/content when present
    try {
      return raw.map((item) => {
        if (item === null || item === undefined) return '';
        if (typeof item === 'string') return item;
        if (typeof item === 'object') {
          if (typeof (item as any).text === 'string') return String((item as any).text);
          if (typeof (item as any).content === 'string') return String((item as any).content);
          if ((item as any).type === 'text' && typeof (item as any).text === 'string') return String((item as any).text);
          return safeStringify(item);
        }
        return String(item);
      }).filter(Boolean).join('\n\n');
    } catch {
      try { return JSON.stringify(raw); } catch { return String(raw); }
    }
  }
  if (typeof raw === 'object') {
    if (typeof (raw as any).text === 'string') return String((raw as any).text);
    if (typeof (raw as any).content === 'string') return String((raw as any).content);
    if ((raw as any).type === 'text' && typeof (raw as any).text === 'string') return String((raw as any).text);
    try { return safeStringify(raw); } catch { return String(raw); }
  }
  return String(raw);
}

// Build a readable error message from object payloads without producing '[object Object]'
function formatErrorMessage(err: any): string {
  if (err === null || err === undefined) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const primary = typeof err.error === 'string' ? err.error : '';
    const detailsStr = typeof err.details === 'string' ? err.details : (err.details ? safeStringify(err.details) : '');
    const codeStr = err.code ? `Code: ${String(err.code)}` : '';
    const joined = [primary, detailsStr, codeStr].filter(Boolean).join(' — ');
    if (joined) return joined;
    try { return safeStringify(err); } catch { return String(err); }
  }
  return String(err);
}

// Helper to safely format table cell values
function formatCell(val: any): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString();
  const t = typeof val;
  if (t === 'string') return val;
  if (t === 'number' || t === 'boolean') return String(val);
  if (t === 'object') {
    // Handle Node Buffer serialized to JSON
    if ((val as any)?.type === 'Buffer' && Array.isArray((val as any)?.data)) {
      return `[Buffer (${(val as any).data.length} bytes)]`;
    }
    // Best-effort readable object
    return safeStringify(val) || String(val);
  }
  return String(val);
}

function extractPrimaryTableFromSQL(sql: string): string | null {
  if (!sql) return null;
  // Strip comments and normalize whitespace
  const cleaned = String(sql)
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Try standard SELECT ... FROM <table>
  const fromMatch = cleaned.match(/\bFROM\b\s+([a-zA-Z0-9_\.\"\`]+)(?:\s|,|;|\)|$)/i);
  if (fromMatch && fromMatch[1]) {
    let t = fromMatch[1];
    t = t.replace(/["\`]/g, '');
    // Remove trailing punctuation
    t = t.replace(/[;,]$/, '');
    return t || null;
  }

  // Fallbacks for other statements
  const insertMatch = cleaned.match(/\bINSERT\s+INTO\s+([a-zA-Z0-9_\.\"\`]+)/i);
  if (insertMatch && insertMatch[1]) return insertMatch[1].replace(/["\`]/g, '');

  const updateMatch = cleaned.match(/\bUPDATE\s+([a-zA-Z0-9_\.\"\`]+)/i);
  if (updateMatch && updateMatch[1]) return updateMatch[1].replace(/["\`]/g, '');

  const deleteMatch = cleaned.match(/\bDELETE\s+FROM\s+([a-zA-Z0-9_\.\"\`]+)/i);
  if (deleteMatch && deleteMatch[1]) return deleteMatch[1].replace(/["\`]/g, '');

  return null;
}

async function fetchColumnsForTable(tableName: string): Promise<string[]> {
  if (!tableName) return [];
  try {
    await ensureApiBase();
    const res = await fetch(`${API_BASE}/data/tables/${encodeURIComponent(tableName)}/columns`);
    if (!res.ok) return [];
    const json = await res.json();
    const cols = (json.columns || []).map((c: any) => (
      c.COLUMN_NAME || c.column_name || c.name || ''
    )).filter((n: string) => !!n);
    return cols as string[];
  } catch {
    return [];
  }
}

// Format tables list for concise display and prompt preambles
function formatTablesDisplay(list: string[]): string {
  try {
    const unique = Array.from(new Set((list || []).filter(Boolean)));
    const max = 6;
    const head = unique.slice(0, max);
    const more = unique.length - head.length;
    return more > 0 ? `${head.join(', ')} (+${more} more)` : head.join(', ');
  } catch {
    return (list || []).join(', ');
  }
}

// Render assistant text with structured paragraphs, lists, headers, and inline formatting
function StructuredAssistantText({ raw }: { raw: string }) {
  const text = polishText(raw || '');

  type Block =
    | { type: 'header'; level: number; text: string }
    | { type: 'line'; text: string }
    | { type: 'ul'; items: string[] }
    | { type: 'ol'; items: string[] }
    | { type: 'code'; lang: string; content: string[] };

  const headerRe = /^\s*(#{1,6})\s+(.*)$/;
  const bulletRe = /^\s*[-*•]\s+(.*)$/;
  const numberRe = /^\s*(\d+)\.\s+(.*)$/;
  const codeBlockRe = /^```(\w*)$/;

  const blocks: Block[] = [];
  const lines = (text || '').replace(/\r\n/g, '\n').split(/\n/);

  let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;
  let currentCode: { lang: string; content: string[] } | null = null;

  const flushList = () => {
    if (currentList && currentList.items.length) {
      blocks.push({ type: currentList.type, items: currentList.items.slice() });
    }
    currentList = null;
  };

  const flushCode = () => {
    if (currentCode) {
      blocks.push({ type: 'code', lang: currentCode.lang, content: currentCode.content });
    }
    currentCode = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    
    // Code block handling
    if (currentCode) {
      if (line.trim() === '```') {
        flushCode();
      } else {
        currentCode.content.push(line);
      }
      continue;
    }
    
    const codeStart = line.match(codeBlockRe);
    if (codeStart) {
      flushList();
      currentCode = { lang: codeStart[1] || 'text', content: [] };
      continue;
    }

    if (!line.trim()) { flushList(); continue; }
    const h = line.match(headerRe);
    if (h) {
      flushList();
      const level = Math.min(h[1].length, 3); // cap at h3 for compact chat
      blocks.push({ type: 'header', level, text: h[2].trim() });
      continue;
    }
    const nb = line.match(numberRe);
    if (nb) {
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(nb[2].trim());
      continue;
    }
    const bb = line.match(bulletRe);
    if (bb) {
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(bb[1].trim());
      continue;
    }
    // Regular content line
    if (currentList) flushList();
    blocks.push({ type: 'line', text: line.trim() });
  }

  // Final flush
  flushList();
  flushCode();

  const renderInline = (s: string) => {
    const nodes: React.ReactNode[] = [];
    let i = 0;
    const pushText = (t: string) => { if (t) nodes.push(t); };

    while (i < s.length) {
      if (s.slice(i).startsWith('**')) {
        const end = s.indexOf('**', i + 2);
        if (end !== -1) {
          const before = s.slice(0, i);
          pushText(before);
          const content = s.slice(i + 2, end);
          nodes.push(<strong key={`b-${i}`} className="font-semibold text-white/90">{content}</strong>);
          s = s.slice(end + 2);
          i = 0;
          continue;
        }
      }
      if (s.slice(i).startsWith('*')) {
        const end = s.indexOf('*', i + 1);
        if (end !== -1) {
          const before = s.slice(0, i);
          pushText(before);
          const content = s.slice(i + 1, end);
          nodes.push(<em key={`i-${i}`} className="text-blue-200/90">{content}</em>);
          s = s.slice(end + 1);
          i = 0;
          continue;
        }
      }
      if (s.slice(i).startsWith('`')) {
        const end = s.indexOf('`', i + 1);
        if (end !== -1) {
          const before = s.slice(0, i);
          pushText(before);
          const content = s.slice(i + 1, end);
          nodes.push(<code key={`c-${i}`} className="px-1 py-0.5 rounded bg-white/10 text-blue-200 font-mono text-[11px]">{content}</code>);
          s = s.slice(end + 1);
          i = 0;
          continue;
        }
      }
      i++;
    }
    pushText(s);
    return <>{nodes}</>;
  };

  const headerClass = (level: number) => {
    switch (level) {
      case 1: return 'text-sm font-bold text-white/90 tracking-tight mb-2 mt-4 first:mt-0 pb-1 border-b border-white/10';
      case 2: return 'text-xs font-semibold text-white/90 tracking-tight mb-1.5 mt-3 first:mt-0';
      default: return 'text-xs font-medium text-white/90 mb-1.5 mt-2 first:mt-0';
    }
  };

  return (
    <div className="font-sans text-white/80 text-[13px] leading-relaxed break-words tracking-wide">
      <div className="space-y-1.5">
        {blocks.map((b, idx) => {
          if (b.type === 'header') {
            return <div key={idx} className={headerClass(b.level)}>{renderInline(b.text)}</div>;
          }
          if (b.type === 'line') {
            return <div key={idx} className="text-white/80">{renderInline(b.text)}</div>;
          }
          if (b.type === 'ul') {
            return (
              <ul key={idx} className="list-disc pl-4 space-y-0.5 my-1 marker:text-blue-400/70">
                {b.items.map((item, i) => (
                  <li key={i} className="text-white/80 pl-0.5">{renderInline(item)}</li>
                ))}
              </ul>
            );
          }
          if (b.type === 'ol') {
            return (
              <ol key={idx} className="list-decimal pl-4 space-y-0.5 my-1 marker:text-blue-400/70 font-mono text-[10px]">
                {b.items.map((item, i) => (
                  <li key={i} className="text-white/80 pl-0.5 font-sans text-[13px]">{renderInline(item)}</li>
                ))}
              </ol>
            );
          }
          if (b.type === 'code') {
            return (
              <div key={idx} className="my-2 rounded-md overflow-hidden border border-white/10 bg-[#0d1117] shadow-sm group/code">
                <div className="flex items-center justify-between px-2.5 py-1 bg-white/5 border-b border-white/5">
                  <span className="text-[9px] uppercase tracking-wider font-semibold text-white/30">{b.lang || 'TEXT'}</span>
                  <button 
                    className="text-[9px] text-white/40 hover:text-white transition-colors opacity-0 group-hover/code:opacity-100"
                    onClick={() => navigator.clipboard.writeText(b.content.join('\n'))}
                  >
                    Copy
                  </button>
                </div>
                <pre className="p-2.5 overflow-x-auto text-[11px] font-mono text-blue-100/90 leading-relaxed scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  {b.content.join('\n')}
                </pre>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function polishText(input: string): string {
  if (!input) return '';
  let s = String(input).trim();
  s = s.replace(/[\t ]+/g, ' ');
  s = s.replace(/\s*([,;:])\s*/g, '$1 ');
  s = s.replace(/\s*\.\s*/g, '. ');
  s = s.replace(/!{2,}/g, '!');
  s = s.replace(/\?{2,}/g, '?');
  s = s.replace(/\s{2,}/g, ' ');
  return s.trim();
}

// Limit assistant explanation length to keep UI concise
function briefenText(input: string, maxWords = 60, maxSentences = 2): string {
  const s = String(input || '').trim();
  if (!s) return '';
  // Remove fenced code if any leaked into explanation
  const noCode = s.replace(/```[\s\S]*?```/g, '').trim();
  // Split into sentences by punctuation
  const sentences = noCode.split(/(?<=\.|\?|!)\s+/).filter(Boolean);
  const limited = sentences.slice(0, Math.max(1, maxSentences)).join(' ');
  const words = limited.split(/\s+/);
  if (words.length <= maxWords) return limited;
  return words.slice(0, maxWords).join(' ') + '…';
}
