# Wii Balance Board (oder Wiimote) unter Windows richtig koppeln, damit es als HID-Gerät erscheint
# und die TV-Seite es per WebHID findet.
#
# Warum: Der Windows-Assistent koppelt Wii-Geräte nur halb – das Board steht dann unter „Bluetooth“,
# fehlt aber unter „Human Interface Devices“ und fliegt nach ein paar Sekunden raus. Die PIN beim
# SYNC-Knopf sind die 6 rohen Bytes der Adapter-Adresse (rückwärts), die man nicht eintippen kann.
# Dieses Skript macht es wie Dolphin & Co. über die Windows-Bluetooth-API:
#   1. alte „Nintendo RVL-…“-Einträge entfernen
#   2. nach dem Board suchen (dafür SYNC im Batteriefach drücken)
#   3. mit der Adapter-Adresse als PIN koppeln (BluetoothAuthenticateDevice)
#   4. HID-Dienst einschalten (BluetoothSetServiceState) → Board erscheint als HID-Gerät
#
# Aufruf:  powershell -ExecutionPolicy Bypass -File scripts\wii-pair.ps1
#          (-OhnePin: nur HID-Dienst einschalten, ohne zu koppeln – falls das Koppeln scheitert)
# Der Inhalt lässt sich auch direkt in ein PowerShell-Fenster einfügen.

param([switch]$OhnePin)

$src = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public static class WiiBt {
  [StructLayout(LayoutKind.Sequential)]
  public struct SYSTEMTIME { public ushort y, mo, dow, d, h, mi, s, ms; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVICE_INFO {
    public uint dwSize;
    public ulong Address;
    public uint ulClassofDevice;
    public bool fConnected;
    public bool fRemembered;
    public bool fAuthenticated;
    public SYSTEMTIME stLastSeen;
    public SYSTEMTIME stLastUsed;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string szName;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct SEARCH_PARAMS {
    public uint dwSize;
    public bool fReturnAuthenticated, fReturnRemembered, fReturnUnknown, fReturnConnected, fIssueInquiry;
    public byte cTimeoutMultiplier;
    public IntPtr hRadio;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct RADIO_PARAMS { public uint dwSize; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct RADIO_INFO {
    public uint dwSize;
    public ulong address;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string szName;
    public uint ulClassofDevice;
    public ushort lmpSubversion;
    public ushort manufacturer;
  }

  [DllImport("bthprops.cpl", SetLastError = true)] static extern IntPtr BluetoothFindFirstRadio(ref RADIO_PARAMS p, out IntPtr hRadio);
  [DllImport("bthprops.cpl", SetLastError = true)] static extern bool BluetoothFindRadioClose(IntPtr h);
  [DllImport("bthprops.cpl", SetLastError = true)] static extern uint BluetoothGetRadioInfo(IntPtr hRadio, ref RADIO_INFO info);
  [DllImport("bthprops.cpl", SetLastError = true)] static extern IntPtr BluetoothFindFirstDevice(ref SEARCH_PARAMS p, ref DEVICE_INFO info);
  [DllImport("bthprops.cpl", SetLastError = true)] static extern bool BluetoothFindNextDevice(IntPtr h, ref DEVICE_INFO info);
  [DllImport("bthprops.cpl", SetLastError = true)] static extern bool BluetoothFindDeviceClose(IntPtr h);
  [DllImport("bthprops.cpl", SetLastError = true)] static extern uint BluetoothRemoveDevice(ref ulong addr);
  [DllImport("bthprops.cpl", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern uint BluetoothAuthenticateDevice(IntPtr hwnd, IntPtr hRadio, ref DEVICE_INFO info, string passkey, uint len);
  [DllImport("bthprops.cpl", SetLastError = true)] static extern uint BluetoothSetServiceState(IntPtr hRadio, ref DEVICE_INFO info, ref Guid svc, uint flags);

  static bool IsWii(string n) { return n != null && (n.Contains("RVL-WBC") || n.Contains("RVL-CNT")); }

  static string Hex(ulong a) {
    string s = a.ToString("X12");
    return s.Substring(0, 2) + ":" + s.Substring(2, 2) + ":" + s.Substring(4, 2) + ":" + s.Substring(6, 2) + ":" + s.Substring(8, 2) + ":" + s.Substring(10, 2);
  }

  static List<DEVICE_INFO> Find(IntPtr hRadio, bool inquiry) {
    var list = new List<DEVICE_INFO>();
    var sp = new SEARCH_PARAMS();
    sp.dwSize = (uint)Marshal.SizeOf(typeof(SEARCH_PARAMS));
    sp.fReturnAuthenticated = true; sp.fReturnRemembered = true; sp.fReturnUnknown = true; sp.fReturnConnected = true;
    sp.fIssueInquiry = inquiry;
    sp.cTimeoutMultiplier = (byte)(inquiry ? 2 : 0);
    sp.hRadio = hRadio;
    var di = new DEVICE_INFO();
    di.dwSize = (uint)Marshal.SizeOf(typeof(DEVICE_INFO));
    IntPtr h = BluetoothFindFirstDevice(ref sp, ref di);
    if (h == IntPtr.Zero) return list;
    do {
      list.Add(di);
      di = new DEVICE_INFO();
      di.dwSize = (uint)Marshal.SizeOf(typeof(DEVICE_INFO));
    } while (BluetoothFindNextDevice(h, ref di));
    BluetoothFindDeviceClose(h);
    return list;
  }

  public static int Run(bool pair) {
    var rp = new RADIO_PARAMS();
    rp.dwSize = (uint)Marshal.SizeOf(typeof(RADIO_PARAMS));
    IntPtr hRadio;
    IntPtr hFind = BluetoothFindFirstRadio(ref rp, out hRadio);
    if (hFind == IntPtr.Zero) { Console.WriteLine("Kein Bluetooth-Adapter gefunden (Bluetooth an?)."); return 1; }
    BluetoothFindRadioClose(hFind);
    var ri = new RADIO_INFO();
    ri.dwSize = (uint)Marshal.SizeOf(typeof(RADIO_INFO));
    BluetoothGetRadioInfo(hRadio, ref ri);
    byte[] host = BitConverter.GetBytes(ri.address); // [0] = niedrigstes Byte = Adresse rückwärts
    Console.WriteLine("Bluetooth-Adapter: " + ri.szName + " (" + Hex(ri.address) + ")");

    foreach (var d in Find(hRadio, false)) {
      if (!IsWii(d.szName)) continue;
      ulong a = d.Address;
      uint r = BluetoothRemoveDevice(ref a);
      Console.WriteLine("Alten Eintrag entfernt: " + d.szName + " (" + Hex(d.Address) + ")" + (r == 0 ? "" : " – Fehler " + r));
    }

    Console.WriteLine();
    Console.WriteLine(">>> Jetzt den roten SYNC-Knopf im Batteriefach drücken (bei Bedarf alle 15 s wiederholen) ...");
    DateTime until = DateTime.Now.AddSeconds(60);
    while (DateTime.Now < until) {
      foreach (var found in Find(hRadio, true)) {
        DEVICE_INFO d = found;
        if (!IsWii(d.szName) || d.fConnected) continue;
        Console.WriteLine("Gefunden: " + d.szName + " (" + Hex(d.Address) + ")");
        if (pair) {
          string pin = new string(new char[] { (char)host[0], (char)host[1], (char)host[2], (char)host[3], (char)host[4], (char)host[5] });
          uint r = BluetoothAuthenticateDevice(IntPtr.Zero, hRadio, ref d, pin, 6);
          Console.WriteLine(r == 0 ? "Gekoppelt (PIN = Adapter-Adresse)." : "Koppeln meldet Fehler " + r + " – schalte HID trotzdem ein.");
        }
        Guid hid = new Guid("00001124-0000-1000-8000-00805f9b34fb");
        uint s = BluetoothSetServiceState(hRadio, ref d, ref hid, 1);
        if (s == 0) {
          Console.WriteLine("HID-Dienst eingeschaltet. Das Board sollte jetzt im Geräte-Manager unter");
          Console.WriteLine("„Human Interface Devices“ stehen – auf der TV-Seite B drücken und auswählen.");
          return 0;
        }
        Console.WriteLine("HID-Dienst konnte nicht eingeschaltet werden (Fehler " + s + ").");
        return 2;
      }
      Thread.Sleep(200);
    }
    Console.WriteLine("Kein Board gefunden. Batterien/Bluetooth prüfen und nochmal starten.");
    return 3;
  }
}
'@

if (-not ('WiiBt' -as [type])) { Add-Type -TypeDefinition $src -Language CSharp }
$code = [WiiBt]::Run(-not $OhnePin.IsPresent)
if ($PSCommandPath) { exit $code }
