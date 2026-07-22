param(
  [Parameter(Mandatory = $true)]
  [int]$OwnerProcessId,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedImagePath,

  [int]$TargetProcessId = 0,

  [string]$ExpectedTargetImagePath = ''
)

$ErrorActionPreference = 'Stop'

$inheritedNames = @([Environment]::GetEnvironmentVariables().Keys | ForEach-Object { [string]$_ })
foreach ($name in @(
  'SYNCVIEW_STAFF_KEY',
  'SYNCVIEW_TEST_CLIENT_TOKEN',
  'SYNCVIEW_STAFF_KEY_FD',
  '_OVN_STAFF_ISSUER',
  '_OVN_STAFF_FD',
  'BASH_ENV',
  'ENV',
  'NODE_OPTIONS'
)) {
  if ($inheritedNames -contains $name) {
    throw "refused inherited protected or startup environment: $name"
  }
}

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class SyncViewWindowsJob
{
    public const uint PROCESS_TERMINATE = 0x0001;
    public const uint PROCESS_SET_QUOTA = 0x0100;
    public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    public const uint SYNCHRONIZE = 0x00100000;
    public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    public const int JobObjectBasicAccountingInformation = 1;
    public const int JobObjectExtendedLimitInformation = 9;
    public const uint WAIT_OBJECT_0 = 0x00000000;
    public const uint INFINITE = 0xffffffff;

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime;
        public long TotalKernelTime;
        public long ThisPeriodTotalUserTime;
        public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information,
        uint informationLength
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool QueryInformationJobObject(
        IntPtr job,
        int informationClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information,
        uint informationLength,
        IntPtr returnLength
    );

    [DllImport("kernel32.dll", EntryPoint = "QueryInformationJobObject", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool QueryInformationJobObjectAccounting(
        IntPtr job,
        int informationClass,
        ref JOBOBJECT_BASIC_ACCOUNTING_INFORMATION information,
        uint informationLength,
        IntPtr returnLength
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool QueryFullProcessImageName(
        IntPtr process,
        uint flags,
        StringBuilder imagePath,
        ref uint size
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr handle);

    public static void ThrowLastError(string operation)
    {
        throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }
}
'@

$job = [IntPtr]::Zero
$owner = [IntPtr]::Zero
$target = [IntPtr]::Zero
$exitCode = 0
$readyWritten = $false
try {
  $job = [SyncViewWindowsJob]::CreateJobObject([IntPtr]::Zero, $null)
  if ($job -eq [IntPtr]::Zero) {
    [SyncViewWindowsJob]::ThrowLastError('CreateJobObject')
  }

  $limits = New-Object SyncViewWindowsJob+JOBOBJECT_EXTENDED_LIMIT_INFORMATION
  $basicLimits = New-Object SyncViewWindowsJob+JOBOBJECT_BASIC_LIMIT_INFORMATION
  $basicLimits.LimitFlags = [SyncViewWindowsJob]::JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
  $limits.BasicLimitInformation = $basicLimits
  $limitSize = [Runtime.InteropServices.Marshal]::SizeOf($limits)
  if (-not [SyncViewWindowsJob]::SetInformationJobObject(
    $job,
    [SyncViewWindowsJob]::JobObjectExtendedLimitInformation,
    [ref]$limits,
    $limitSize
  )) {
    [SyncViewWindowsJob]::ThrowLastError('SetInformationJobObject')
  }
  $verifiedLimits = New-Object SyncViewWindowsJob+JOBOBJECT_EXTENDED_LIMIT_INFORMATION
  if (-not [SyncViewWindowsJob]::QueryInformationJobObject(
    $job,
    [SyncViewWindowsJob]::JobObjectExtendedLimitInformation,
    [ref]$verifiedLimits,
    $limitSize,
    [IntPtr]::Zero
  )) {
    [SyncViewWindowsJob]::ThrowLastError('QueryInformationJobObject')
  }
  if (($verifiedLimits.BasicLimitInformation.LimitFlags `
      -band [SyncViewWindowsJob]::JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) -eq 0) {
    throw 'Job Object kill-on-close verification failed'
  }

  $access = [SyncViewWindowsJob]::PROCESS_TERMINATE `
    -bor [SyncViewWindowsJob]::PROCESS_SET_QUOTA `
    -bor [SyncViewWindowsJob]::PROCESS_QUERY_LIMITED_INFORMATION `
    -bor [SyncViewWindowsJob]::SYNCHRONIZE
  $owner = [SyncViewWindowsJob]::OpenProcess($access, $false, [uint32]$OwnerProcessId)
  if ($owner -eq [IntPtr]::Zero) {
    [SyncViewWindowsJob]::ThrowLastError('OpenProcess')
  }

  $image = New-Object Text.StringBuilder 32768
  [uint32]$imageLength = $image.Capacity
  if (-not [SyncViewWindowsJob]::QueryFullProcessImageName($owner, 0, $image, [ref]$imageLength)) {
    [SyncViewWindowsJob]::ThrowLastError('QueryFullProcessImageName')
  }
  $actualImage = [IO.Path]::GetFullPath($image.ToString())
  $expectedImage = [IO.Path]::GetFullPath($ExpectedImagePath)
  if (-not $actualImage.Equals($expectedImage, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'owner image identity mismatch'
  }

  if ($TargetProcessId -gt 0) {
    if ([string]::IsNullOrWhiteSpace($ExpectedTargetImagePath)) {
      throw 'target image identity unavailable'
    }
    $target = [SyncViewWindowsJob]::OpenProcess($access, $false, [uint32]$TargetProcessId)
    if ($target -eq [IntPtr]::Zero) {
      [SyncViewWindowsJob]::ThrowLastError('OpenProcess target')
    }
    $targetImage = New-Object Text.StringBuilder 32768
    [uint32]$targetImageLength = $targetImage.Capacity
    if (-not [SyncViewWindowsJob]::QueryFullProcessImageName($target, 0, $targetImage, [ref]$targetImageLength)) {
      [SyncViewWindowsJob]::ThrowLastError('QueryFullProcessImageName target')
    }
    $actualTargetImage = [IO.Path]::GetFullPath($targetImage.ToString())
    $expectedTargetImage = [IO.Path]::GetFullPath($ExpectedTargetImagePath)
    if (-not $actualTargetImage.Equals($expectedTargetImage, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'target image identity mismatch'
    }
  } else {
    $target = $owner
  }

  if (-not [SyncViewWindowsJob]::AssignProcessToJobObject($job, $target)) {
    [SyncViewWindowsJob]::ThrowLastError('AssignProcessToJobObject')
  }

  [Console]::Out.WriteLine('READY')
  [Console]::Out.Flush()
  $readyWritten = $true

  if ($TargetProcessId -gt 0) {
    $control = [Console]::In.ReadLine()
    if ($control -ne 'COMPLETE') {
      [Console]::Out.WriteLine('ERROR')
      [Console]::Out.Flush()
      $exitCode = 70
    } else {
      $wait = [SyncViewWindowsJob]::WaitForSingleObject($target, 5000)
      if ($wait -ne [SyncViewWindowsJob]::WAIT_OBJECT_0) {
        throw 'target did not exit before completion'
      }
      $accountingSize = [Runtime.InteropServices.Marshal]::SizeOf(
        [type][SyncViewWindowsJob+JOBOBJECT_BASIC_ACCOUNTING_INFORMATION]
      )
      $activeProcesses = [uint32]::MaxValue
      for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
        $accounting = New-Object SyncViewWindowsJob+JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
        if (-not [SyncViewWindowsJob]::QueryInformationJobObjectAccounting(
          $job,
          [SyncViewWindowsJob]::JobObjectBasicAccountingInformation,
          [ref]$accounting,
          $accountingSize,
          [IntPtr]::Zero
        )) {
          [SyncViewWindowsJob]::ThrowLastError('QueryInformationJobObject accounting')
        }
        $activeProcesses = $accounting.ActiveProcesses
        if ($activeProcesses -eq 0) { break }
        [Threading.Thread]::Sleep(25)
      }
      if ($activeProcesses -eq 0) {
        [Console]::Out.WriteLine('CLEAN')
      } else {
        [Console]::Out.WriteLine('STRAGGLERS')
        $exitCode = 75
      }
      [Console]::Out.Flush()
    }
  } else {
    $wait = [SyncViewWindowsJob]::WaitForSingleObject($owner, [SyncViewWindowsJob]::INFINITE)
    if ($wait -ne [SyncViewWindowsJob]::WAIT_OBJECT_0) {
      [SyncViewWindowsJob]::ThrowLastError('WaitForSingleObject')
    }
  }
}
catch {
  [Console]::Error.WriteLine('REFUSED: Windows process-tree containment failed')
  [Console]::Out.WriteLine('ERROR')
  [Console]::Out.Flush()
  $exitCode = 69
}
finally {
  if ($target -ne [IntPtr]::Zero -and $target -ne $owner) {
    [void][SyncViewWindowsJob]::CloseHandle($target)
  }
  if ($owner -ne [IntPtr]::Zero) {
    [void][SyncViewWindowsJob]::CloseHandle($owner)
  }
  if ($job -ne [IntPtr]::Zero) {
    [void][SyncViewWindowsJob]::CloseHandle($job)
  }
}
if ($exitCode -ne 0) {
  exit $exitCode
}
