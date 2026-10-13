'use strict';

(function (root, factory) {
  const workflow = factory();
  if (typeof module === 'object' && module.exports) module.exports = workflow;
  else root.CGAIChatWorkflow = workflow;
})(typeof window === 'undefined' ? globalThis : window, function () {
  const levels = ['Low', 'Medium', 'High'];
  const actions = ['accept', 'decline', 'transfer'];

  function normalizeMessage(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function trimHistory(history, limit = 60) {
    return Array.isArray(history) ? history.slice(-limit) : [];
  }

  async function parseResponse(response) {
    if (!response || typeof response.ok !== 'boolean') {
      throw new Error('The assistant returned an invalid response. Please try again.');
    }
    let data;
    try {
      data = await response.json();
    } catch {
      if (!response.ok) throw new Error(`The assistant service is unavailable (HTTP ${response.status}). Please try again.`);
      throw new Error('The assistant returned invalid JSON. Please try again.');
    }
    if (!response.ok) {
      const detail = Array.isArray(data?.detail)
        ? data.detail.map((entry) => entry?.msg).filter(Boolean).join(' ')
        : data?.detail;
      throw new Error(typeof detail === 'string' && detail.trim()
        ? detail
        : `The assistant service is unavailable (HTTP ${response.status}). Please try again.`);
    }
    if (!data || typeof data.reply !== 'string' || !data.reply.trim()
      || typeof data.summary !== 'string' || !data.summary.trim()
      || typeof data.intent !== 'string' || !data.intent.trim()
      || !levels.includes(data.urgency) || !levels.includes(data.risk)
      || typeof data.review_required !== 'boolean'
      || typeof data.sensitive_info_requested !== 'boolean'
      || !actions.includes(data.suggested_action)) {
      throw new Error('The assistant returned incomplete call analysis. Please try again.');
    }
    return data;
  }

  async function send({ text, request, onPending, onSuccess, onFailure, onSettled }) {
    const message = normalizeMessage(text);
    if (!message) throw new Error('Type a caller message first.');
    if (typeof request !== 'function') throw new TypeError('A chat request function is required.');
    onPending?.(message);
    try {
      const response = await request(message);
      const data = await parseResponse(response);
      await onSuccess?.(data, message);
      return data;
    } catch (error) {
      onFailure?.(error instanceof Error ? error : new Error('The assistant could not respond. Please try again.'), message);
      return null;
    } finally {
      onSettled?.(message);
    }
  }

  return { normalizeMessage, trimHistory, parseResponse, send };
});
