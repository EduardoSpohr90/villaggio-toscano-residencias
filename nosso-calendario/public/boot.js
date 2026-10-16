// Rede de segurança carregada antes do app: se o bundle falhar ao iniciar
// (erro de script, cache antigo), mostra uma opção de recuperação que limpa o
// service worker e recarrega — o usuário nunca fica preso numa tela vazia.
(function () {
  function show() {
    if (window.__ncMounted) return;
    var el = document.getElementById('boot-error');
    if (el) el.hidden = false;
  }
  var timer = setTimeout(show, 12000);
  window.addEventListener('error', function () {
    setTimeout(show, 1500);
  });
  window.addEventListener('nc:mounted', function () {
    clearTimeout(timer);
  });
  document.addEventListener('click', function (e) {
    if (!e.target || e.target.id !== 'boot-reset') return;
    var done = function () { location.reload(); };
    try {
      var jobs = [];
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
          return Promise.all(rs.map(function (r) { return r.unregister(); }));
        }));
      }
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(function (ks) {
          return Promise.all(ks.map(function (k) { return caches.delete(k); }));
        }));
      }
      Promise.all(jobs).then(done, done);
    } catch (err) {
      done();
    }
  });
})();
