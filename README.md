# Antes del Viaje

App para organizar los pendientes antes de un viaje (o cualquier actividad):
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
