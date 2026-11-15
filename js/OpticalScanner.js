/* Akari · OpticalScanner
   Camera reader (WebRTC getUserMedia). Working stub: opens the camera, shows the preview and returns a
   SIMULATED reading clearly marked as such. The colorimetric strip and fatigue analysis are not implemented.
   Fails gracefully with no camera, no permission or an insecure origin.
   Classic script: exposes window.OpticalScanner. */
(function (g) {
  'use strict';
  let stream = null, timer = null;

  function stop() {
    clearTimeout(timer); timer = null;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  function why(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Se negó el permiso de cámara. Escriba el valor a mano.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No se encontró cámara. Escriba el valor a mano.';
    if (n === 'NotReadableError') return 'La cámara está ocupada por otra aplicación. Escriba el valor a mano.';
    return 'La cámara no está disponible aquí. Escriba el valor a mano.';
  }

  /* host: element to render into; def: channel definition; guess(): plausible value for the demo; done(value) */
  async function open(host, def, guess, done) {
    stop();
    host.innerHTML = `<div class="cam"><span class="lab">Cámara · ${def.name}</span><p class="note" data-cam-msg>Abriendo la cámara…</p></div>`;
    const msg = host.querySelector('[data-cam-msg]');
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) { msg.textContent = g.isSecureContext === false ? 'La cámara necesita una página segura (https o localhost). Escriba el valor a mano.' : why(); return false; }
    try {
      stream = await md.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 } }, audio: false });
    } catch (e) { msg.textContent = why(e); return false; }
    if (!host.isConnected) { stop(); return false; }
    msg.insertAdjacentHTML('beforebegin', '<div class="camv"><video playsinline muted></video></div>');
    const v = host.querySelector('video');
    v.srcObject = stream; v.play().catch(() => {});
    msg.textContent = def.id === 'mood' ? 'Mire a la cámara unos segundos.' : 'Ponga la tira o la pantalla del aparato dentro del recuadro.';
    timer = setTimeout(() => {
      const val = guess();
      const shown = def.id === 'bp' ? `${val.sys}/${val.dia}` : def.id === 'sleep' ? val.toFixed(1) + ' h' : String(val);
      msg.innerHTML = `<b>Lectura simulada: ${shown} ${def.id === 'sleep' ? '' : def.unit}</b><br>Solo demostración. El análisis real de la tira aún no existe.`;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn pri sm'; b.textContent = 'Usar este valor';
      b.onclick = () => { stop(); done(val); };
      msg.after(b);
    }, 2400);
    return true;
  }

  g.OpticalScanner = { open, stop, get active() { return !!stream; } };
})(window);
