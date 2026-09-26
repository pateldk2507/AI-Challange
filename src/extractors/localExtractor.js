import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

export async function extractPdf(buffer, originalName = 'upload.pdf') {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'form-qc-'));
  try {
    const pdfPath = path.join(tempDir, 'input.pdf');
    await writeFile(pdfPath, buffer);
    const script = path.join(__dirname, '..', 'local', 'analyze_pdf.py');
    const python = process.env.PYTHON_BIN || 'python3';
    const { stdout } = await run(python, [script, pdfPath, originalName], {
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });
    return JSON.parse(stdout);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
