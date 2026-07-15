export const e2eSteps = [
  'Ayuntamiento configura ruta',
  'Asigna camión y conductor',
  'Conductor inicia',
  'Mapa muestra avance',
  'Se registra incidencia',
  'Supervisor revisa',
  'Ruta termina',
  'Ciudadano consulta estado',
  'Dashboard actualiza cumplimiento'
];

let index = 0;
const steps = document.querySelector('#steps');
const current = document.querySelector('#current');
function render() {
  steps.innerHTML = e2eSteps.map((step, stepIndex) => `<p>${stepIndex <= index ? '●' : '○'} ${step}</p>`).join('');
  current.textContent = `Paso ${index + 1} de ${e2eSteps.length}: ${e2eSteps[index]}`;
}
document.querySelector('#next').addEventListener('click', () => { index = (index + 1) % e2eSteps.length; render(); });
render();
