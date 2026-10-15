Pod::Spec.new do |s|
  s.name           = 'AyaNowPlaying'
  s.version        = '1.0.0'
  s.summary        = 'Now Playing playhead, remote commands and audio route handling for Aya'
  s.description    = 'Publishes MPNowPlayingInfoCenter playhead data for the Dynamic Island, Lock Screen and CarPlay, forwards MPRemoteCommandCenter commands to JS, and reports AVAudioSession route changes/interruptions.'
  s.author         = 'Ahsan Ansari'
  s.homepage       = 'https://github.com/ansari342/Ansit'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'MediaPlayer', 'AVFoundation'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
