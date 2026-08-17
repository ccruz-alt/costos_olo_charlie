/**
 * OLO — Subir fotos de SKUs a Supabase Storage
 * ─────────────────────────────────────────────
 * Ejecutar desde la carpeta "out/":
 *   node upload_fotos.js
 *
 * Requisitos: node_modules/@supabase/supabase-js (ya instalado)
 * Tiempo estimado: 2–5 min para las ~10.262 fotos (129 MB)
 */

'use strict';
const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

// ── Configuración ──────────────────────────────────────────────
const SB_URL     = 'https://ktrccitliwvwhfapwzzc.supabase.co';
const SB_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0cmNjaXRsaXd2d2hmYXB3enpjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjQ4NTk2OSwiZXhwIjoyMTAyMDYxOTY5fQ.nh3omIlBuWULR0XgZQUF5H988lYRFi6thmL7w8CWI_k';
const BUCKET     = 'fotos';
const CONCURRENCY = 12;   // uploads paralelos (ajustá si hay errores de red)
const MAX_RETRIES = 3;    // reintentos por archivo

// Carpeta de fotos relativa a este script
const FOTOS_DIR = path.join(__dirname, 'out', 'Panel_Comercial_Mayoreo_4', 'fotos');
const EMPRESAS  = ['Cofersa', 'Febeca', 'Sillaca'];

const supabase = createClient(SB_URL, SB_KEY);

// ── Crear / verificar bucket ───────────────────────────────────
async function ensureBucket() {
  const { data: existing } = await supabase.storage.listBuckets();
  if (existing && existing.find(b => b.name === BUCKET)) {
    console.log(`  ✓ Bucket "${BUCKET}" ya existe`);
    return;
  }
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,           // acceso público para que el panel cargue sin auth
    fileSizeLimit: null,    // sin límite de tamaño por archivo
    allowedMimeTypes: ['image/jpeg', 'image/jpg'],
  });
  if (error) throw new Error('No se pudo crear el bucket: ' + error.message);
  console.log(`  ✓ Bucket "${BUCKET}" creado (público)`);
}

// ── Upload individual con reintentos ───────────────────────────
async function uploadFile(localPath, storagePath, attempt = 1) {
  const buffer = fs.readFileSync(localPath);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: 'image/jpeg',
      upsert: false,   // no re-sube si ya existe (permite resumir)
    });

  if (error) {
    // "already exists" = ya estaba subida, no es un error real
    if (error.message && (
      error.message.includes('already exists') ||
      error.message.includes('resource already exists') ||
      error.statusCode === '409'
    )) return 'skip';

    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 800 * attempt)); // back-off
      return uploadFile(localPath, storagePath, attempt + 1);
    }
    throw error;
  }
  return 'ok';
}

// ── Pool de concurrencia ───────────────────────────────────────
async function runPool(tasks, concurrency, onProgress) {
  let i = 0, done = 0, errors = 0, skipped = 0;
  const total = tasks.length;

  async function worker() {
    while (i < tasks.length) {
      const task = tasks[i++];
      try {
        const result = await task();
        if (result === 'skip') skipped++;
      } catch (e) {
        errors++;
        // Muestra el error pero no detiene el proceso
        process.stdout.write('\n  ✗ ' + e.message + '\n');
      }
      done++;
      onProgress(done, total, errors, skipped);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { errors, skipped };
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  OLO — Fotos SKU → Supabase Storage          ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // 1. Verificar que exista la carpeta de fotos
  if (!fs.existsSync(FOTOS_DIR)) {
    console.error(`✗ No se encontró la carpeta de fotos en:\n  ${FOTOS_DIR}`);
    console.error('  Asegurate de correr el script desde la carpeta "out/"');
    process.exit(1);
  }

  // 2. Crear bucket si no existe
  console.log('1. Verificando bucket en Supabase Storage...');
  await ensureBucket();

  // 3. Upload por empresa
  let grandTotal = 0, grandErrors = 0, grandSkipped = 0;
  const t0 = Date.now();

  for (const empresa of EMPRESAS) {
    const dir = path.join(FOTOS_DIR, empresa);
    if (!fs.existsSync(dir)) {
      console.log(`\n  ⚠ Carpeta "${empresa}" no encontrada, saltando`);
      continue;
    }

    const files = fs.readdirSync(dir)
      .filter(f => /\.(jpg|jpeg)$/i.test(f));

    if (!files.length) {
      console.log(`\n  ⚠ "${empresa}" sin archivos JPG`);
      continue;
    }

    console.log(`\n2. Subiendo ${empresa}: ${files.length.toLocaleString('es-CR')} fotos...`);
    process.stdout.write('  ');

    const tasks = files.map(file => () =>
      uploadFile(
        path.join(dir, file),
        `${empresa}/${file}`
      )
    );

    let lastPct = -1;
    const { errors, skipped } = await runPool(tasks, CONCURRENCY, (done, total, err, skip) => {
      const pct = Math.floor(done / total * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
        process.stdout.write(`\r  [${bar}] ${pct}% — ${done}/${total} (${err} errores, ${skip} ya existían)   `);
      }
    });

    console.log('');
    console.log(`  ✓ ${empresa} listo: ${files.length - errors - skipped} nuevas, ${skipped} ya existían, ${errors} errores`);
    grandTotal += files.length;
    grandErrors += errors;
    grandSkipped += skipped;
  }

  const seg = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log(`║  ✅ Completado en ${seg}s`.padEnd(45) + '║');
  console.log(`║  📸 ${grandTotal.toLocaleString('es-CR')} fotos · ${grandErrors} errores · ${grandSkipped} ya existían`.padEnd(46) + '║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('URL base de las fotos:');
  console.log(`  ${SB_URL}/storage/v1/object/public/${BUCKET}/`);
  console.log('');
  console.log('Ejemplo Cofersa:');
  console.log(`  ${SB_URL}/storage/v1/object/public/${BUCKET}/Cofersa/0002001.jpg`);
  console.log('');

  if (grandErrors > 0) {
    console.log(`⚠ Hubo ${grandErrors} errores. Podés re-correr el script — los archivos ya subidos se saltean automáticamente.`);
    console.log('');
  }
}

main().catch(e => {
  console.error('\n✗ Error fatal:', e.message);
  process.exit(1);
});
