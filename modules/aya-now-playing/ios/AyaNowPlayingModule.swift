import ExpoModulesCore
import MediaPlayer
import AVFoundation
import UIKit

/// Metadata + playhead snapshot pushed from JS for the current ayah.
struct NowPlayingRecord: Record {
  @Field var title: String = ""
  @Field var artist: String = ""
  @Field var album: String = ""
  @Field var positionSec: Double = 0
  @Field var durationSec: Double = 0
  @Field var isPlaying: Bool = false
  @Field var rate: Double = 1.0
  @Field var trackIndex: Int = 0
  @Field var trackCount: Int = 0
}

/**
 * AyaNowPlaying publishes the live playhead to MPNowPlayingInfoCenter (which drives the
 * Dynamic Island, Lock Screen and CarPlay "Now Playing" screens), forwards MPRemoteCommandCenter
 * commands (play / pause / next / previous / scrub) to JS, and reports AVAudioSession route
 * changes so JS can pause instead of silently rerouting to the iPhone speaker when CarPlay or
 * Bluetooth audio disappears.
 */
public class AyaNowPlayingModule: Module {
  private var commandTargets: [(MPRemoteCommand, Any)] = []
  private var notificationObservers: [NSObjectProtocol] = []
  private var cachedArtwork: MPMediaItemArtwork?
  private var isSetUp = false

  public func definition() -> ModuleDefinition {
    Name("AyaNowPlaying")

    Events("onRemoteCommand", "onAudioRouteChange", "onAudioInterruption")

    OnCreate {
      DispatchQueue.main.async { [weak self] in
        self?.setUpIfNeeded()
      }
    }

    OnDestroy {
      self.tearDown()
    }

    Function("updateNowPlaying") { (record: NowPlayingRecord) in
      self.applyNowPlaying(record)
    }

    Function("updatePlayback") { (positionSec: Double, durationSec: Double, isPlaying: Bool, rate: Double) in
      self.applyPlayback(positionSec: positionSec, durationSec: durationSec, isPlaying: isPlaying, rate: rate)
    }

    Function("clearNowPlaying") {
      DispatchQueue.main.async {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
      }
    }

    Function("getCurrentRouteOutputs") { () -> [String] in
      return AVAudioSession.sharedInstance().currentRoute.outputs.map { $0.portType.rawValue }
    }
  }

  // MARK: - Setup / Teardown

  private func setUpIfNeeded() {
    guard !isSetUp else { return }
    isSetUp = true

    UIApplication.shared.beginReceivingRemoteControlEvents()
    registerRemoteCommands()
    registerAudioSessionObservers()
  }

  private func tearDown() {
    for (command, target) in commandTargets {
      command.removeTarget(target)
    }
    commandTargets.removeAll()

    for observer in notificationObservers {
      NotificationCenter.default.removeObserver(observer)
    }
    notificationObservers.removeAll()

    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    isSetUp = false
  }

  // MARK: - Remote Commands (Dynamic Island, Lock Screen, CarPlay, AirPods, Steering Wheel)

  private func registerRemoteCommands() {
    let center = MPRemoteCommandCenter.shared()

    addCommand(center.playCommand, name: "play")
    addCommand(center.pauseCommand, name: "pause")
    addCommand(center.togglePlayPauseCommand, name: "togglePlayPause")
    addCommand(center.nextTrackCommand, name: "nextTrack")
    addCommand(center.previousTrackCommand, name: "previousTrack")
    addCommand(center.changePlaybackPositionCommand, name: "changePlaybackPosition")

    // Disable skip-interval commands so CarPlay shows Previous / Next ayah instead of ±15s
    center.skipForwardCommand.isEnabled = false
    center.skipBackwardCommand.isEnabled = false
    center.seekForwardCommand.isEnabled = false
    center.seekBackwardCommand.isEnabled = false
  }

  private func addCommand(_ command: MPRemoteCommand, name: String) {
    command.isEnabled = true
    let target = command.addTarget { [weak self] event in
      var payload: [String: Any?] = ["command": name]
      if let positionEvent = event as? MPChangePlaybackPositionCommandEvent {
        payload["positionSec"] = positionEvent.positionTime
      }
      self?.sendEvent("onRemoteCommand", payload)
      return .success
    }
    commandTargets.append((command, target))
  }

  // MARK: - Audio Session Route Changes & Interruptions

  private func registerAudioSessionObservers() {
    let routeObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.routeChangeNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      guard let self = self else { return }
      let reasonRaw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
      let reason = AVAudioSession.RouteChangeReason(rawValue: reasonRaw) ?? .unknown
      let previousRoute = notification.userInfo?[AVAudioSessionRouteChangePreviousRouteKey] as? AVAudioSessionRouteDescription
      let previousOutputs = previousRoute?.outputs.map { $0.portType.rawValue } ?? []
      let currentOutputs = AVAudioSession.sharedInstance().currentRoute.outputs.map { $0.portType.rawValue }

      self.sendEvent("onAudioRouteChange", [
        "reason": self.describe(reason),
        "isOldDeviceUnavailable": reason == .oldDeviceUnavailable,
        "previousOutputs": previousOutputs,
        "currentOutputs": currentOutputs,
      ])
    }
    notificationObservers.append(routeObserver)

    let interruptionObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      guard let self = self else { return }
      let typeRaw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt ?? 0
      let type = AVAudioSession.InterruptionType(rawValue: typeRaw)
      var shouldResume = false
      if let optionsRaw = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt {
        shouldResume = AVAudioSession.InterruptionOptions(rawValue: optionsRaw).contains(.shouldResume)
      }
      self.sendEvent("onAudioInterruption", [
        "type": type == .began ? "began" : "ended",
        "shouldResume": shouldResume,
      ])
    }
    notificationObservers.append(interruptionObserver)
  }

  private func describe(_ reason: AVAudioSession.RouteChangeReason) -> String {
    switch reason {
    case .newDeviceAvailable: return "newDeviceAvailable"
    case .oldDeviceUnavailable: return "oldDeviceUnavailable"
    case .categoryChange: return "categoryChange"
    case .override: return "override"
    case .wakeFromSleep: return "wakeFromSleep"
    case .noSuitableRouteForCategory: return "noSuitableRouteForCategory"
    case .routeConfigurationChange: return "routeConfigurationChange"
    default: return "unknown"
    }
  }

  // MARK: - Now Playing Info

  private func applyNowPlaying(_ record: NowPlayingRecord) {
    let artwork = makeArtwork()
    DispatchQueue.main.async {
      var info: [String: Any] = [
        MPMediaItemPropertyTitle: record.title,
        MPMediaItemPropertyArtist: record.artist,
        MPMediaItemPropertyAlbumTitle: record.album,
        MPMediaItemPropertyPlaybackDuration: max(0.1, record.durationSec),
        MPNowPlayingInfoPropertyElapsedPlaybackTime: max(0, min(record.positionSec, record.durationSec)),
        MPNowPlayingInfoPropertyPlaybackRate: record.isPlaying ? record.rate : 0.0,
        MPNowPlayingInfoPropertyDefaultPlaybackRate: record.rate,
        MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        MPNowPlayingInfoPropertyIsLiveStream: false,
        MPMediaItemPropertyArtwork: artwork,
      ]
      if record.trackCount > 0 {
        info[MPNowPlayingInfoPropertyPlaybackQueueIndex] = record.trackIndex
        info[MPNowPlayingInfoPropertyPlaybackQueueCount] = record.trackCount
      }
      MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
  }

  private func applyPlayback(positionSec: Double, durationSec: Double, isPlaying: Bool, rate: Double) {
    DispatchQueue.main.async {
      var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
      info[MPMediaItemPropertyPlaybackDuration] = max(0.1, durationSec)
      info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = max(0, min(positionSec, durationSec))
      info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? rate : 0.0
      info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = rate
      MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
  }

  // MARK: - Artwork

  private func makeArtwork() -> MPMediaItemArtwork {
    if let cached = cachedArtwork { return cached }
    let image = UIImage(named: "AppIcon") ?? renderFallbackArtwork(size: CGSize(width: 600, height: 600))
    let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    cachedArtwork = artwork
    return artwork
  }

  /// Midnight-navy square with gilded "آية" wordmark, matching Aya's visual identity.
  private func renderFallbackArtwork(size: CGSize) -> UIImage {
    let renderer = UIGraphicsImageRenderer(size: size)
    return renderer.image { ctx in
      let rect = CGRect(origin: .zero, size: size)
      let colors = [
        UIColor(red: 0.047, green: 0.071, blue: 0.125, alpha: 1).cgColor,
        UIColor(red: 0.031, green: 0.043, blue: 0.067, alpha: 1).cgColor,
      ] as CFArray
      if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
        ctx.cgContext.drawLinearGradient(
          gradient,
          start: CGPoint(x: 0, y: 0),
          end: CGPoint(x: size.width, y: size.height),
          options: []
        )
      } else {
        UIColor.black.setFill()
        ctx.fill(rect)
      }

      let paragraph = NSMutableParagraphStyle()
      paragraph.alignment = .center
      let attributes: [NSAttributedString.Key: Any] = [
        .font: UIFont.systemFont(ofSize: size.width * 0.34, weight: .bold),
        .foregroundColor: UIColor(red: 0.898, green: 0.722, blue: 0.412, alpha: 1),
        .paragraphStyle: paragraph,
      ]
      let text = "آية" as NSString
      let textSize = text.size(withAttributes: attributes)
      let textRect = CGRect(
        x: 0,
        y: (size.height - textSize.height) / 2,
        width: size.width,
        height: textSize.height
      )
      text.draw(in: textRect, withAttributes: attributes)
    }
  }
}
