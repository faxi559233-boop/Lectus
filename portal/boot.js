(async () => {
  try { const r = await api('GET', '/api/auth/me'); P.user = r.user; await refreshUnread(); } catch (e) { P.user = null; }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/portal/sw.js', { scope: '/portal/' }).catch(() => {});
  render();
})();
