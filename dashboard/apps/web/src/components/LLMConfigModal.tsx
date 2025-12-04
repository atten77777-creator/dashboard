import React, { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { API_BASE, ensureApiBase } from '../api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfigured?: () => void;
}

export function LLMConfigModal({ isOpen, onClose, onConfigured }: Props) {
  const [selectedLLM, setSelectedLLM] = useState<'openai' | 'gemini' | 'azure' | 'openai_compatible' | 'anthropic' | 'ollama'>('openai');
  const [apiKey, setApiKey] = useState('');
  // Azure-specific
  const [azureEndpoint, setAzureEndpoint] = useState('');
  const [azureDeployment, setAzureDeployment] = useState('');
  const [azureApiVersion, setAzureApiVersion] = useState('2024-05-01-preview');
  // OpenAI-compatible (e.g., OpenRouter, Groq, Together)
  const [ocBaseUrl, setOcBaseUrl] = useState('https://api.openrouter.ai/v1');
  const [ocModel, setOcModel] = useState('gpt-4o-mini');
  // Anthropic
  const [anthropicModel, setAnthropicModel] = useState('claude-3-5-sonnet-latest');
  // Ollama
  const [ollamaHost, setOllamaHost] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('llama3.1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      await ensureApiBase();
      const payload =
        selectedLLM === 'azure'
          ? { type: 'azure', apiKey, endpoint: azureEndpoint, deployment: azureDeployment, apiVersion: azureApiVersion }
          : selectedLLM === 'openai_compatible'
          ? { type: 'openai_compatible', apiKey, baseUrl: ocBaseUrl, model: ocModel }
          : selectedLLM === 'anthropic'
          ? { type: 'anthropic', apiKey, model: anthropicModel }
          : selectedLLM === 'ollama'
          ? { type: 'ollama', ollamaHost, model: ollamaModel }
          : { type: selectedLLM, apiKey };

      const res = await fetch(`${API_BASE}/chat/configure-llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        // Surface backend error verbatim (prefer JSON fields, else raw text)
        try {
          const err = await res.json();
          throw new Error(String(err?.error || err?.details || JSON.stringify(err)));
        } catch {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
      }
      
      // Do not close immediately; perform connectivity test first
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setSuccess(null);
    setError(null);
    setDisconnecting(true);
    try {
      await ensureApiBase();
      const res = await fetch(`${API_BASE}/chat/disconnect-llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: selectedLLM })
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Failed to disconnect');
      }
      setSuccess('Disconnected successfully. AI is disabled until reconfigured.');
    } catch (e: any) {
      setError(e?.message || 'Disconnect failed');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="AI Configuration" width={640}>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-1">
            <label className="block text-xs text-white/70 mb-1">Model</label>
            <select value={selectedLLM} onChange={(e) => setSelectedLLM(e.target.value as any)} className="glass w-full rounded-md p-2 text-xs">
              <option value="openai">OpenAI</option>
              <option value="gemini">Google Gemini</option>
              <option value="azure">Azure OpenAI</option>
              <option value="openai_compatible">OpenAI Compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>
          <div className="col-span-3">
            <label className="block text-xs text-white/70 mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={selectedLLM === 'ollama' ? 'Not required for Ollama' : 'Paste API key'}
              disabled={selectedLLM === 'ollama'}
              className="glass w-full rounded-md p-2 text-xs disabled:opacity-60"
            />
          </div>
        </div>

        {selectedLLM !== 'azure' && (
          <p className="text-xs text-white/60">Get a key from provider dashboard.</p>
        )}

        {selectedLLM === 'azure' && (
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-3">
              <label className="block text-xs text-white/70 mb-1">Endpoint</label>
              <input value={azureEndpoint} onChange={e => setAzureEndpoint(e.target.value)} placeholder="https://your-resource.openai.azure.com" className="glass w-full rounded-md p-2 text-xs" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-white/70 mb-1">Deployment</label>
              <input value={azureDeployment} onChange={e => setAzureDeployment(e.target.value)} placeholder="gpt-35-turbo" className="glass w-full rounded-md p-2 text-xs" />
            </div>
            <div>
              <label className="block text-xs text-white/70 mb-1">API Version</label>
              <input value={azureApiVersion} onChange={e => setAzureApiVersion(e.target.value)} placeholder="2024-05-01-preview" className="glass w-full rounded-md p-2 text-xs" />
            </div>
          </div>
        )}

        {selectedLLM === 'openai_compatible' && (
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-xs text-white/70 mb-1">Base URL</label>
              <input value={ocBaseUrl} onChange={e => setOcBaseUrl(e.target.value)} placeholder="https://api.openrouter.ai/v1" className="glass w-full rounded-md p-2 text-xs" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs text-white/70 mb-1">Model</label>
              <input value={ocModel} onChange={e => setOcModel(e.target.value)} placeholder="gpt-4o-mini or groq/llama3-70b-8192" className="glass w-full rounded-md p-2 text-xs" />
            </div>
            <div className="col-span-3 text-xs text-white/60">
              Works with OpenRouter, Groq (`/openai/v1`), Together, and similar.
            </div>
          </div>
        )}

        {selectedLLM === 'anthropic' && (
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-xs text-white/70 mb-1">Model</label>
              <input value={anthropicModel} onChange={e => setAnthropicModel(e.target.value)} placeholder="claude-3-5-sonnet-latest" className="glass w-full rounded-md p-2 text-xs" />
            </div>
            <div className="col-span-3 text-xs text-white/60">
              Uses Anthropic Messages API.
            </div>
          </div>
        )}

        {selectedLLM === 'ollama' && (
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-xs text-white/70 mb-1">Host</label>
              <input value={ollamaHost} onChange={e => setOllamaHost(e.target.value)} placeholder="http://localhost:11434" className="glass w-full rounded-md p-2 text-xs" />
            </div>
            <div className="col-span-1">
              <label className="block text-xs text-white/70 mb-1">Model</label>
              <input value={ollamaModel} onChange={e => setOllamaModel(e.target.value)} placeholder="llama3.1 or mistral:7b" className="glass w-full rounded-md p-2 text-xs" />
            </div>
            <div className="col-span-3 text-xs text-white/60">
              Ensure the model is pulled in Ollama: `ollama pull llama3.1`.
            </div>
          </div>
        )}

        {error && (
          <div className="p-2 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>
        )}
        {success && (
          <div className="p-2 rounded-md bg-green-500/10 border border-green-500/20 text-green-400 text-xs">{success}</div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="ghost" onClick={async () => {
            await handleDisconnect();
            // Persist disconnected status
            try {
              await ensureApiBase();
              await fetch(`${API_BASE}/state/llm-configs`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: selectedLLM, connected: false })
              });
            } catch {}
          }} loading={disconnecting}>Disconnect</Button>
          <Button variant="primary" onClick={async () => {
            setSuccess(null); setError(null); await handleSubmit();
            try {
              await ensureApiBase();
              const res = await fetch(`${API_BASE}/chat/test-llm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: selectedLLM }) });
              if (!res.ok) {
                // Show backend error exactly
                try {
                  const err = await res.json();
                  setError(String(err?.error || err?.details || JSON.stringify(err)));
                } catch {
                  const txt = await res.text();
                  setError(txt || `HTTP ${res.status}`);
                }
                return;
              }
              const data = await res.json();
              setSuccess('Connected successfully. You can chat now.');
              onConfigured?.();
              // Persist LLM config and connected status
              const cfg =
                selectedLLM === 'azure'
                  ? { apiKey, endpoint: azureEndpoint, deployment: azureDeployment, apiVersion: azureApiVersion }
                  : selectedLLM === 'openai_compatible'
                  ? { apiKey, baseUrl: ocBaseUrl, model: ocModel }
                  : selectedLLM === 'anthropic'
                  ? { apiKey, model: anthropicModel }
                  : selectedLLM === 'ollama'
                  ? { ollamaHost, model: ollamaModel }
                  : { apiKey };
              try {
                await ensureApiBase();
                await fetch(`${API_BASE}/state/llm-configs`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ type: selectedLLM, config: cfg, connected: true })
                });
              } catch {}
            } catch (e: any) {
              setError(String(e?.message || e));
            }
          }} loading={loading} disabled={selectedLLM === 'azure' ? (!apiKey.trim() || !azureEndpoint.trim() || !azureDeployment.trim()) : selectedLLM === 'openai_compatible' ? (!apiKey.trim() || !ocBaseUrl.trim() || !ocModel.trim()) : selectedLLM === 'anthropic' ? (!apiKey.trim() || !anthropicModel.trim()) : selectedLLM === 'ollama' ? (!ollamaHost.trim() || !ollamaModel.trim()) : (!apiKey.trim())}>Save & Test</Button>
        </div>
      </div>
    </Modal>
  );
}