// Estilo de los controles, común al panel y a la banda del selector.
//
// Tres estados para todo lo pulsable del mod:
//   · en reposo: el texto en su color, o atenuado si es secundario;
//   · encima (puntero): un fondo suave del tema y el texto a plena intensidad;
//   · elegido: una píldora rellena del color de acento, con la tinta que mejor
//     se lee encima y en negrita.
// El terminal invierte el botón bajo el puntero, que convierte una píldora
// elegida en otra apagada. Cada botón nombra su propio grupo de hover, y con
// `inverse: false` en ese grupo el estilo lo pone el mod en lugar del motor.
// El foco del teclado (Tab con la banda o el panel enfocados) sigue invirtiendo.

// Fondo del hover: el gris de los bordes del tema, claro u oscuro.
export const FONDO_ENCIMA = 'subtle'
// Fondo liso de las barras: el mismo gris, como carril por llenar.
export const CARRIL = 'subtle'

// El grupo de hover de un control: hasta 64 caracteres y único en el mod (los
// largos, como una ruta, se acortan con un resumen para no chocar).
export function grupo(id: string): string {
  const completo = `cv:${id}`
  if (completo.length <= 64) return completo
  let h = 0
  for (let i = 0; i < completo.length; i++) h = (Math.imul(h, 31) + completo.charCodeAt(i)) | 0
  return `${completo.slice(0, 54)}~${(h >>> 0).toString(36)}`
}

// Lo que va en el `hover` del propio Button: su grupo y sin la inversión.
export function sinInvertir(id: string): { scope: string; inverse: false } {
  return { scope: grupo(id), inverse: false }
}

// Lo que va en el `hover` de un Text dentro del Button: su grupo y el estilo.
export function encima<T extends Record<string, unknown>>(id: string, estilo: T): T & { scope: string } {
  return { scope: grupo(id), ...estilo }
}
