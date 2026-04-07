import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Search, Sparkles, Link as LinkIcon, Upload } from 'lucide-react';

export default function SearchInterface({
  onQuerySubmit,
  onDatabaseConnect,
  onDatabaseDisconnect,
  onDatasetImportFromUrl,
  onDatasetImportFromCsv,
  onClearImportedDataset,
  isDatabaseConnected,
  databaseStatus,
  importedDataset,
  importStatus,
  showQuery = true,
}) {
  const [query, setQuery] = useState("");
  const [dbUrl, setDbUrl] = useState('');
  const [datasetUrl, setDatasetUrl] = useState('');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, []);

  const suggestions = [
    "Show sales trend over last year",
    "What are the top 5 products?",
    "Compare B2B vs B2C revenue"
  ];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (query.trim()) {
      onQuerySubmit(query);
    }
  };

  const handleSurpriseMe = () => {
    const random = suggestions[Math.floor(Math.random() * suggestions.length)];
    setQuery(random);
    setTimeout(() => onQuerySubmit(random), 300);
  };

  const handleImportLink = () => {
    onDatasetImportFromUrl?.(datasetUrl);
  };

  const handleCsvChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    onDatasetImportFromCsv?.(text, file.name);
    event.target.value = '';
  };

  const toggleMic = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setQuery((prev) => prev || 'Show me the profit by region');
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setQuery(transcript);
        onQuerySubmit(transcript);
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="query-interface"
    >
      <div className="query-header">
        <span className="query-badge">
          <Sparkles size={14} />
          Conversational Analytics
        </span>
        <h2>Ask your business data</h2>
        <p>Type a natural-language query to generate BI-ready visualizations and insight summaries.</p>
      </div>

      <form onSubmit={handleSubmit} className="query-form">
        {showQuery ? (
          <div className="query-input-wrap">
            <Search size={18} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Show monthly revenue trend by region"
              autoFocus
            />

            <div className="query-actions">
              <button
                type="button"
                onClick={toggleMic}
                className={`icon-btn ${isListening ? 'listening' : ''}`}
                aria-label="Voice input"
              >
                <Mic size={16} />
              </button>
              <button type="submit" className="btn-primary">
                Generate
              </button>
            </div>
          </div>
        ) : null}

        <div className="dataset-input-row">
          <input
            type="text"
            value={dbUrl}
            onChange={(e) => setDbUrl(e.target.value)}
            placeholder="Enter database connection URL (postgresql://user:password@host:5432/dbname)"
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onDatabaseConnect?.(dbUrl)}
          >
            Connect Database
          </button>
          {isDatabaseConnected ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onDatabaseDisconnect?.()}
            >
              Disconnect Database
            </button>
          ) : null}
        </div>
        {databaseStatus ? <p className="dataset-status">{databaseStatus}</p> : null}

        <div className="dataset-import-card">
          <div className="query-header" style={{ marginBottom: '10px' }}>
            <span className="query-badge">
              <Sparkles size={14} />
              Import Dataset
            </span>
            <p style={{ margin: '8px 0 0', color: '#94a3b8', fontSize: '13px' }}>Use a link or upload a CSV file.</p>
          </div>

          <div className="dataset-input-row">
            <input
              type="url"
              value={datasetUrl}
              onChange={(e) => setDatasetUrl(e.target.value)}
              placeholder="Paste CSV / Google Sheet link"
            />
            <button type="button" className="btn-secondary" onClick={handleImportLink}>
              <LinkIcon size={14} />
              Import Link
            </button>
          </div>

          <div className="dataset-input-row" style={{ marginTop: '10px' }}>
            <label className="btn-secondary" style={{ cursor: 'pointer' }}>
              <Upload size={14} />
              Upload CSV
              <input type="file" accept=".csv,text/csv" onChange={handleCsvChange} style={{ display: 'none' }} />
            </label>
            {importedDataset?.datasetId ? (
              <button type="button" className="btn-secondary" onClick={() => onClearImportedDataset?.()}>
                Clear Imported Dataset
              </button>
            ) : null}
          </div>

          {importStatus ? <p className="dataset-status">{importStatus}</p> : null}
        </div>

        <AnimatePresence>
          {showQuery && isListening && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="listening-text"
            >
              Listening for your query...
            </motion.p>
          )}
        </AnimatePresence>
      </form>

      {showQuery ? (
        <div className="query-suggestions">
          <button type="button" onClick={handleSurpriseMe} className="btn-secondary">
            Surprise Me
          </button>
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setQuery(s);
                setTimeout(() => onQuerySubmit(s), 300);
              }}
              className="suggestion-chip"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </motion.div>
  );
}
