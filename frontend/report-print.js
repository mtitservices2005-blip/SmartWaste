// SW-115: manda un reporte (HTML completo) a imprimir desde un marco oculto. El navegador abre su diálogo de impresión:
// "Guardar como PDF" lo descarga. El título del documento es el nombre sugerido del archivo.
export function printReport(html, { doc = document, timeoutMs = 60000 } = {}) {
  const frame = doc.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  doc.body.appendChild(frame);
  const cleanup = () => { try { frame.remove(); } catch { /* ya no está */ } };
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) { cleanup(); return; }
    win.addEventListener?.('afterprint', cleanup);
    setTimeout(cleanup, timeoutMs);
    // Espera un tick para que el marco termine de maquetar antes de abrir el diálogo.
    setTimeout(() => { try { win.focus(); win.print(); } catch { cleanup(); } }, 150);
  };
  frame.srcdoc = html;
  return frame;
}
