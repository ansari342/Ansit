Pod::Spec.new do |s|
  s.name           = 'AyaPitchDetector'
  s.version        = '1.0.0'
  s.summary        = 'Real-time microphone pitch (f0) detection for Aya'
  s.description    = 'Taps the AVAudioEngine microphone input and streams YIN fundamental-frequency estimates to JS at ~40 Hz.'
  s.author         = 'Ahsan Ansari'
  s.homepage       = 'https://github.com/ansari342/Ansit'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
