package com.rakazo.nativelog

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Reads this app's own native log (logcat) and memory, for the on-device
 * speech diagnostics. Android only — the speech engine's native loader
 * logs its failures to logcat and dies with exit(-1) or a native abort,
 * which no Java catch can see, so the log is the only record of why an
 * init crashed. An app can only read its own log entries, so this returns
 * this app's lines only, filtered to the speech tags below.
 */
class RakazoNativeLogModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RakazoNativeLog")

    /**
     * The last [maxLines] logcat lines for the speech tags, oldest first.
     * Empty when logcat cannot be read. Bounded to 2000 lines.
     */
    AsyncFunction("readLog") { maxLines: Int ->
      readLogcat(maxLines)
    }

    /** Total and available RAM in KiB, from /proc/meminfo. Zero when unreadable. */
    AsyncFunction("memoryInfo") {
      readMemoryInfo()
    }
  }

  private fun readLogcat(maxLines: Int): String {
    val limit = maxLines.coerceIn(1, 2000)
    val command = mutableListOf("logcat", "-d", "-v", "time")
    for (tag in LOG_TAGS) {
      command += "$tag:V"
    }
    command += "*:S"
    return try {
      val process = ProcessBuilder(command).redirectErrorStream(true).start()
      val lines = process.inputStream.bufferedReader().readLines()
      if (!process.waitFor(10, TimeUnit.SECONDS)) {
        process.destroy()
      }
      lines.takeLast(limit).joinToString("\n")
    } catch (_: Exception) {
      ""
    }
  }

  private fun readMemoryInfo(): Map<String, Double> {
    var totalKb = 0.0
    var availableKb = 0.0
    runCatching {
      File("/proc/meminfo").forEachLine { line ->
        val parts = line.split(":", limit = 2)
        if (parts.size != 2) return@forEachLine
        val value = parts[1].trim().split(" ").firstOrNull()?.toDoubleOrNull()
          ?: return@forEachLine
        when (parts[0].trim()) {
          "MemTotal" -> totalKb = value
          "MemAvailable" -> availableKb = value
        }
      }
    }
    return mapOf("memTotalKB" to totalKb, "memAvailableKB" to availableKb)
  }

  companion object {
    /** The speech engine, its loader, and the runtime's crash lines. */
    private val LOG_TAGS = listOf(
      "sherpa-onnx",
      "SherpaOnnx",
      "SherpaOnnxTts",
      "AndroidRuntime",
      "DEBUG",
      "libc",
    )
  }
}
