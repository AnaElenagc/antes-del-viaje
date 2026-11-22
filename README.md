# Antes de

App para organizar lo que tienes que hacer antes de un viaje, una mudanza, un evento o unas compras:
tareas por tipo, fecha ideal y fecha límite, presupuesto en soles y dólares,
y recordatorios para Google Calendar o el calendario del iPhone (.ics).

- Página estática (HTML + JS), sin paso de compilación. Se publica tal cual en Vercel.
- Datos e inicio de sesión (enlace por correo) con Supabase. Cada usuario solo ve sus datos (Row Level Security).
- Se puede instalar en el celular: "Agregar a pantalla de inicio".

## Archivos
- `index.html`: estructura y estilos
- `app.js`: lógica de la app
- `supabase.js`: cliente de Supabase (v2.45.4)
- `manifest.webmanifest`, `icon*.png`, `icon.svg`: para instalarla como app

## Créditos
- Banderas: fuente "Twemoji Country Flags" de [country-flag-emoji-polyfill](https://github.com/talkjs/country-flag-emoji-polyfill) (código MIT), con gráficos de [Twemoji](https://github.com/jdecked/twemoji) bajo licencia CC-BY 4.0.
