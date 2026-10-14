// Sends raw ESC/POS bytes to a printer.
// Windows: through the print spooler in RAW mode, using a small PowerShell helper (no extra software).
// Network printers: TCP port 9100. Mac/Linux: `lp -o raw`.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export type PrinterConfig = {
  /** Windows printer name as shown in Settings, or "tcp://192.168.1.50" for a network printer, or "" for none. */
  target: string;
};

const PS_RAW = `
param([string]$Printer, [string]$File)
$code = @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public class RawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
  public static string Send(string printer, byte[] bytes) {
    IntPtr h; DOCINFOA di = new DOCINFOA(); di.pDocName = "POS receipt"; di.pDataType = "RAW";
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "Printer not found: " + printer;
    try {
      if (!StartDocPrinter(h, 1, di)) return "Could not start print job (error " + Marshal.GetLastWin32Error() + ")";
      StartPagePrinter(h);
      IntPtr p = Marshal.AllocCoTaskMem(bytes.Length); Marshal.Copy(bytes, 0, p, bytes.Length);
      int written; bool ok = WritePrinter(h, p, bytes.Length, out written);
      Marshal.FreeCoTaskMem(p); EndPagePrinter(h); EndDocPrinter(h);
      return ok ? "OK" : "Write failed (error " + Marshal.GetLastWin32Error() + ")";
    } finally { ClosePrinter(h); }
  }
}
"@
Add-Type -TypeDefinition $code
[RawPrint]::Send($Printer, [System.IO.File]::ReadAllBytes($File))
`;

function run(cmd: string, args: string[], timeoutMs = 20000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => { child.kill(); resolve({ code: null, out: out + '\nTimed out.' }); }, timeoutMs);
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: null, out: String(e) }); });
  });
}

export async function sendToPrinter(cfg: PrinterConfig, bytes: Buffer): Promise<void> {
  const target = cfg.target.trim();
  if (!target) throw new Error('No printer is set up. Enter the printer name in Settings.');
  if (/^tcp:\/\//.test(target)) {
    const [host, portStr] = target.replace(/^tcp:\/\//, '').split(':');
    await new Promise<void>((resolve, reject) => {
      const sock = net.createConnection({ host, port: Number(portStr ?? 9100) });
      sock.setTimeout(8000);
      sock.on('connect', () => sock.end(bytes));
      sock.on('close', () => resolve());
      sock.on('timeout', () => { sock.destroy(); reject(new Error(`The printer at ${host} did not answer.`)); });
      sock.on('error', (e) => reject(new Error(`Could not reach the printer at ${host}: ${e.message}`)));
    });
    return;
  }
  const tmp = path.join(os.tmpdir(), `pos-print-${Date.now()}.bin`);
  fs.writeFileSync(tmp, bytes);
  try {
    if (process.platform === 'win32') {
      const script = path.join(os.tmpdir(), 'pos-rawprint.ps1');
      if (!fs.existsSync(script)) fs.writeFileSync(script, PS_RAW);
      const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Printer', target, '-File', tmp]);
      const msg = r.out.trim().split('\n').pop()?.trim() ?? '';
      if (r.code !== 0 || msg !== 'OK') throw new Error(msg || 'Printing failed. Is the printer on and installed in Windows?');
    } else {
      const r = await run('lp', ['-d', target, '-o', 'raw', tmp]);
      if (r.code !== 0) throw new Error(r.out.trim() || 'Printing failed.');
    }
  } finally { fs.rmSync(tmp, { force: true }); }
}

// ---------- USB cash drawer (serial trigger) ----------
// Drawers with a USB cable show up in Windows as a COM port (often a Prolific or CH340 "USB Serial").
// They open when any ESC/POS drawer pulse arrives on that port; some also open on the DTR/RTS lines going high.
const PS_DRAWER = `
param([string]$Port, [string]$File)
try {
  $sp = New-Object System.IO.Ports.SerialPort $Port, 9600, 'None', 8, 'One'
  $sp.WriteTimeout = 2000
  $sp.Open()
  $sp.DtrEnable = $true; $sp.RtsEnable = $true
  $bytes = [System.IO.File]::ReadAllBytes($File)
  $sp.Write($bytes, 0, $bytes.Length)
  Start-Sleep -Milliseconds 400
  $sp.DtrEnable = $false; $sp.RtsEnable = $false
  $sp.Close()
  "OK"
} catch { "Drawer port " + $Port + ": " + $_.Exception.Message }
`;

/** Open a USB cash drawer on a serial port such as "COM4" (Windows) or "/dev/ttyUSB0" (Linux/Mac). */
export async function pulseSerialDrawer(port: string, bytes: Buffer): Promise<void> {
  const p = port.trim();
  if (!p) throw new Error('No cash drawer port is set.');
  const tmp = path.join(os.tmpdir(), `pos-drawer-${Date.now()}.bin`);
  fs.writeFileSync(tmp, bytes);
  try {
    if (process.platform === 'win32') {
      const script = path.join(os.tmpdir(), 'pos-drawer-v1.ps1');
      if (!fs.existsSync(script)) fs.writeFileSync(script, PS_DRAWER);
      const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Port', p, '-File', tmp], 10000);
      const msg = r.out.trim().split('\n').pop()?.trim() ?? '';
      if (r.code !== 0 || msg !== 'OK') throw new Error(msg || `Could not open the drawer on ${p}.`);
    } else {
      await new Promise<void>((resolve, reject) => {
        fs.writeFile(p, bytes, (e) => (e ? reject(new Error(`Could not open the drawer on ${p}: ${e.message}`)) : resolve()));
      });
    }
  } finally { fs.rmSync(tmp, { force: true }); }
}

/** Serial ports present right now, with a friendly name (Windows only; empty elsewhere). */
export async function listSerialPorts(): Promise<{ port: string; name: string }[]> {
  if (process.platform !== 'win32') return [];
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\((COM\\d+)\\)' } | ForEach-Object { $_.Name }"]);
  return r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((name) => {
    const m = /\((COM\d+)\)/.exec(name);
    return { port: m?.[1] ?? name, name };
  });
}

/** Names of installed printers (Windows only; empty elsewhere). */
export async function listPrinters(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name']);
  return r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
