import ExpoModulesCore
import AVFoundation

/**
 * AyaPitchDetector taps the iPhone microphone through AVAudioEngine and streams real-time
 * fundamental-frequency (f0) estimates to JS using the YIN algorithm with parabolic refinement.
 *
 * It keeps the shared AVAudioSession in `.playAndRecord` routed to the loudspeaker (not the
 * earpiece) so the reciter guide track stays audible while the user recites along.
 */
public class AyaPitchDetectorModule: Module {
  private var engine: AVAudioEngine?
  private var running = false
  private var sampleRate: Double = 48000
  private var ring: [Float] = []
  private let analysisWindow = 2048
  private let maxRing = 4096
  private var lastEmitTime: CFAbsoluteTime = 0
  private let emitIntervalSec: CFAbsoluteTime = 0.025
  private let analysisQueue = DispatchQueue(label: "com.ahsanansari.aya.pitch", qos: .userInteractive)
  private var routeObserver: NSObjectProtocol?
  private var configObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("AyaPitchDetector")

    Events("onPitch")

    AsyncFunction("start") { (promise: Promise) in
      self.requestPermissionAndStart(promise)
    }

    AsyncFunction("stop") {
      self.stopEngine()
    }

    Function("isRunning") { () -> Bool in
      return self.running
    }

    OnDestroy {
      self.stopEngine()
    }
  }

  // MARK: - Lifecycle

  private func requestPermissionAndStart(_ promise: Promise) {
    AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
      guard let self = self else {
        promise.resolve(false)
        return
      }
      guard granted else {
        promise.resolve(false)
        return
      }
      DispatchQueue.main.async {
        promise.resolve(self.startEngine())
      }
    }
  }

  private func configureSessionForSpeakerRecording() {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(
        .playAndRecord,
        mode: .default,
        options: [.defaultToSpeaker, .allowBluetoothA2DP, .allowAirPlay]
      )
      try session.setActive(true, options: [])
      try session.overrideOutputAudioPort(.speaker)
    } catch {
      // Non-fatal: we still attempt to start the engine on whatever session is active
    }
  }

  private func startEngine() -> Bool {
    stopEngine()
    configureSessionForSpeakerRecording()

    let engine = AVAudioEngine()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      return false
    }
    sampleRate = format.sampleRate
    ring.removeAll(keepingCapacity: true)

    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.ingest(buffer)
    }

    engine.prepare()
    do {
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      return false
    }

    self.engine = engine
    running = true
    installObservers()
    return true
  }

  private func stopEngine() {
    running = false
    if let engine = engine {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
    }
    engine = nil
    removeObservers()
    analysisQueue.async { [weak self] in
      self?.ring.removeAll()
    }
  }

  // MARK: - Session observers (keep output on loudspeaker while other modules touch the session)

  private func installObservers() {
    removeObservers()
    routeObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.routeChangeNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      guard let self = self, self.running else { return }
      let outputs = AVAudioSession.sharedInstance().currentRoute.outputs.map { $0.portType }
      if outputs.contains(.builtInReceiver) {
        try? AVAudioSession.sharedInstance().overrideOutputAudioPort(.speaker)
      }
    }
    configObserver = NotificationCenter.default.addObserver(
      forName: .AVAudioEngineConfigurationChange,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      guard let self = self, self.running, let engine = self.engine, !engine.isRunning else { return }
      engine.prepare()
      try? engine.start()
    }
  }

  private func removeObservers() {
    if let o = routeObserver { NotificationCenter.default.removeObserver(o) }
    if let o = configObserver { NotificationCenter.default.removeObserver(o) }
    routeObserver = nil
    configObserver = nil
  }

  // MARK: - Audio ingest & analysis

  private func ingest(_ buffer: AVAudioPCMBuffer) {
    guard running, let channel = buffer.floatChannelData?[0] else { return }
    let count = Int(buffer.frameLength)
    if count == 0 { return }
    let samples = Array(UnsafeBufferPointer(start: channel, count: count))

    analysisQueue.async { [weak self] in
      guard let self = self, self.running else { return }
      self.ring.append(contentsOf: samples)
      if self.ring.count > self.maxRing {
        self.ring.removeFirst(self.ring.count - self.maxRing)
      }
      let now = CFAbsoluteTimeGetCurrent()
      guard self.ring.count >= self.analysisWindow, now - self.lastEmitTime >= self.emitIntervalSec else { return }
      self.lastEmitTime = now

      let window = Array(self.ring.suffix(self.analysisWindow))
      let result = self.detectPitch(window, sampleRate: self.sampleRate)
      let db: Double = result.rms > 0.00001 ? 20.0 * log10(Double(result.rms)) : -160.0
      let payload: [String: Any?] = [
        "freqHz": result.freqHz ?? 0,
        "midi": result.freqHz != nil ? 69.0 + 12.0 * log2(result.freqHz! / 440.0) : 0,
        "confidence": result.confidence,
        "rms": Double(result.rms),
        "db": db,
        "isVoiced": result.freqHz != nil,
        "timestamp": now * 1000.0,
      ]
      DispatchQueue.main.async { [weak self] in
        self?.sendEvent("onPitch", payload)
      }
    }
  }

  /// YIN fundamental frequency estimator (de Cheveigné & Kawahara) with parabolic interpolation.
  private func detectPitch(_ x: [Float], sampleRate: Double) -> (freqHz: Double?, confidence: Double, rms: Float) {
    let n = x.count
    var energy: Float = 0
    for v in x { energy += v * v }
    let rms = sqrt(energy / Float(max(1, n)))
    if rms < 0.0035 {
      return (nil, 1, rms)
    }

    let fMin = 60.0
    let fMax = 500.0
    let minLag = Int(sampleRate / fMax)
    let maxLag = min(Int(sampleRate / fMin), n / 2)
    let half = n / 2
    if maxLag <= minLag + 2 { return (nil, 1, rms) }

    var cmndf = [Float](repeating: 1, count: maxLag + 1)
    var running: Float = 0
    x.withUnsafeBufferPointer { p in
      for tau in 1...maxLag {
        var sum: Float = 0
        var i = 0
        while i < half {
          let d = p[i] - p[i + tau]
          sum += d * d
          i += 1
        }
        running += sum
        cmndf[tau] = running > 0 ? (sum * Float(tau)) / running : 1
      }
    }

    let threshold: Float = 0.18
    var tau = -1
    var t = minLag
    while t < maxLag {
      if cmndf[t] < threshold {
        while t + 1 < maxLag && cmndf[t + 1] < cmndf[t] { t += 1 }
        tau = t
        break
      }
      t += 1
    }
    if tau == -1 {
      var best: Float = 1
      for k in minLag...maxLag where cmndf[k] < best {
        best = cmndf[k]
        tau = k
      }
      if best > 0.38 { return (nil, Double(best), rms) }
    }

    // Prefer the true period over a sub-harmonic when a clean dip exists at half the lag
    let halfTau = tau / 2
    if halfTau >= minLag, cmndf[halfTau] < 0.2, cmndf[halfTau] <= cmndf[tau] + 0.05 {
      tau = halfTau
    }

    var refined = Double(tau)
    if tau > minLag && tau < maxLag {
      let s0 = Double(cmndf[tau - 1])
      let s1 = Double(cmndf[tau])
      let s2 = Double(cmndf[tau + 1])
      let denom = 2 * (2 * s1 - s2 - s0)
      if abs(denom) > 1e-9 {
        refined = Double(tau) + (s2 - s0) / denom
      }
    }
    let hz = sampleRate / refined
    if hz < fMin || hz > fMax { return (nil, 1, rms) }
    return (hz, Double(cmndf[tau]), rms)
  }
}
