# 🎮 Duelo de Piezas — Tetris 1v1 Online

Juego para **dos personas por internet**: en la primera ronda el Jugador 1 elige qué tetrominós entrega al Jugador 2, que intenta colocarlos. En la segunda ronda cambian los papeles. Gana quien suma más puntos limpiando filas (en caso de empate, gana quien logra colocar más piezas).

## Lo que incluye

- Salas privadas de 8 caracteres y enlace de invitación con un clic.
- Dos navegadores diferentes sincronizados en tiempo real con WebSockets.
- Servidor que valida roles, movimientos, colisiones, puntuaciones y cambios de ronda.
- 16, 24 o 36 piezas por ronda, tablero 10×20, 7 piezas, rotación, caída automática y sombra.
- Desconexiones temporales: la partida se pausa y se reanuda al reconectar (mientras el proceso siga encendido).
- Botones para móvil y teclado (flechas / WASD / espacio).
- Revanchas sin cambiar de sala. No hace falta crear cuentas.

## Jugar en tu computadora

1. Instalá [Node.js](https://nodejs.org/) versión 20 o superior.
2. Extraé el ZIP, abrí una terminal en esta carpeta y ejecutá:

   ```bash
   npm install
   npm start
   ```
3. Abrí **http://localhost:3000** en tu navegador.
4. Para probar con otro navegador de la misma computadora, abrí otra ventana o ventana privada y pegá la URL con `?room=...`.

**Importante:** `localhost` no es una dirección pública: enviar esa URL a alguien lejos de tu red **no le permitirá jugar**.

## Compartir un enlace real con un amigo (publicación gratuita)

Se necesita un servidor con acceso público. La opción más directa es **GitHub + Render**:

1. Creá una cuenta en [GitHub](https://github.com) y un repositorio nuevo (por ejemplo `duelo-de-piezas`).
2. Subí **todos los archivos de esta carpeta** (incluida la carpeta `public` y `server.js`) al repositorio. No subas `node_modules`.
3. Entrá a [Render](https://dashboard.render.com/), elegí **New → Web Service**, conectá tu repositorio de GitHub y seleccioná:
   - **Language / Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Esperá a que Render muestre el servicio como **Live** y copiá su URL `https://<tu-sitio>.onrender.com`.
5. Abrí esa URL, hacé clic en **Crear sala privada**, luego **Copiar enlace** y mandalo a tu amigo. Él abre el enlace, escribe su nombre, presiona **Entrar a la sala**, y vos iniciás la partida.

Render puede suspender servicios gratis después de 15 minutos de inactividad. Al volver a abrir el sitio puede demorar en activarse. Las salas y partidas solo existen en la memoria del servidor: si Render lo reinicia, se pierden. El juego es un prototipo para disfrutar con amigos, no un servicio permanente.

## Puntuación

- 1 línea: 100 puntos.
- 2 líneas simultáneas: 300 puntos.
- 3 líneas: 500 puntos.
- 4 líneas: 800 puntos.
- Empate en puntos: gana quien pudo colocar más piezas.
- Si el tablero no tiene espacio para la nueva pieza, la ronda termina antes.

## Estructura

```text
duelo-de-piezas-online/
├── public/
│   ├── index.html   # Pantalla y elementos del juego
│   ├── style.css    # Diseño adaptativo
│   └── app.js       # Cliente: tablero, botones, salas, WebSocket
├── server.js        # Servidor y reglas de Tetris
├── package.json     # Dependencias (ws)
├── render.yaml      # Configuración opcional de Render
└── tests/           # Pruebas automatizadas
```

> **Seguridad:** el código de sala funciona como invitación. Compartilo solo con las personas que quieras invitar. No utiliza contraseñas, ni graba nombres permanentemente.
