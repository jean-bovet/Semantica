# Adaptive Performance Management for Indexing

## Overview
Replace the manual CPU throttle setting with an intelligent system that automatically adjusts indexing concurrency based on hardware capabilities, power state, thermal conditions, and system usage patterns.

## Current State
- Manual CPU setting (Low/Medium/High) in UI
- Fixed concurrency of 5 files regardless of setting
- Memory-based throttling (800MB threshold)
- No awareness of battery/power state
- No thermal management

## Proposed Solution

### 1. Core Detection & Base Concurrency
```javascript
// Use modern API with fallback
const availableCores = os.availableParallelism?.() || os.cpus().length;
const baseConcurrency = Math.max(1, availableCores - 1); // Reserve 1 core for system/UI
```

### 2. Dynamic Adjustment Factors

#### Power State Monitoring
Using Electron's `powerMonitor` API:
- **On AC Power**: 100% of base concurrency
- **On Battery**: 30-50% of base concurrency
- **Low Battery (<20%)**: Minimum concurrency (1-2 files)

#### Thermal State Management
Monitor `thermal-state-change` events:
- `nominal`: 100% concurrency
- `fair`: 75% concurrency
- `serious`: 50% concurrency
- `critical`: 25% concurrency (minimum 1)

#### CPU Speed Limiting
React to `speed-limit-change` events:
- When CPU is throttled below 80%, reduce concurrency proportionally

#### Memory Pressure (Existing)
- Above 800MB RSS: Throttle to 2 concurrent
- Below 800MB: Use calculated concurrency

#### Activity-Based Adjustment
- Business hours (9am-5pm weekdays): -25% concurrency
- Night hours (10pm-6am): +25% concurrency
- Active user detection: Reduce when other apps using >70% CPU

### 3. Adaptive Batch Sizing
Adjust chunk sizes based on performance mode:
- **High performance**: 750 characters per chunk
- **Balanced**: 500 characters per chunk
- **Low power**: 250 characters per chunk

### 4. Implementation Architecture

```javascript
class AdaptivePerformanceManager {
  constructor() {
    this.baseConcurrency = Math.max(1, os.availableParallelism() - 1);
    this.currentFactors = {
      power: 1.0,      // Battery vs AC
      thermal: 1.0,    // Thermal state
      cpuLimit: 1.0,   // CPU speed limit
      timeOfDay: 1.0,  // User activity prediction
      memory: 1.0      // Memory pressure
    };
    
    this.initializeMonitoring();
  }

  calculateOptimalConcurrency() {
    const effectiveMultiplier = Object.values(this.currentFactors)
      .reduce((acc, val) => acc * val, 1.0);
    
    return Math.max(1, Math.round(this.baseConcurrency * effectiveMultiplier));
  }

  initializeMonitoring() {
    // Power state monitoring
    powerMonitor.on('on-battery', () => this.updatePowerState(true));
    powerMonitor.on('on-ac', () => this.updatePowerState(false));
    
    // Thermal monitoring
    powerMonitor.on('thermal-state-change', (state) => this.updateThermalState(state));
    
    // CPU speed limit monitoring
    powerMonitor.on('speed-limit-change', (limit) => this.updateCpuLimit(limit));
  }
}
```

### 5. User Interface Changes

#### Remove Manual CPU Setting
- Remove the CPU usage dropdown from settings
- Replace with automatic performance indicator

#### Performance Status Display
Show current performance mode in UI:
- "🚀 High Performance" (AC power, good thermals)
- "⚖️ Balanced" (normal conditions)
- "🔋 Battery Saver" (on battery)
- "🔥 Thermal Throttling" (system hot)
- "💤 Low Priority" (user active)

#### Progress Bar Enhancement
- Show current concurrency in tooltip
- Display performance mode icon
- Color coding: Green (full), Yellow (reduced), Orange (throttled)

### 6. Configuration & Overrides

#### Hidden Advanced Settings
For power users, maintain a config file option:
```json
{
  "performance": {
    "mode": "auto",              // auto | manual
    "manualConcurrency": 5,      // Used only if mode is manual
    "respectPowerSaving": true,  // Honor battery/power state
    "respectThermalLimits": true,// Honor thermal throttling
    "adaptToUserActivity": true  // Reduce during active use
  }
}
```

#### Emergency Overrides
- Cmd+Shift+P: Toggle performance mode
- System tray menu: Force high/low performance

### 7. Monitoring & Metrics

#### Local Telemetry (Privacy-Preserving)
Track locally without sending data:
- Files indexed per minute at each concurrency level
- Battery drain rate during indexing
- Thermal events frequency
- Memory pressure events
- Average completion time per file type

#### Performance Dashboard (Future)
- Show indexing efficiency graph
- Display thermal history
- Battery impact visualization
- Optimization suggestions

### 8. Migration Strategy

#### Phase 1: Core Implementation
1. Implement AdaptivePerformanceManager class
2. Add power state monitoring
3. Add thermal state monitoring
4. Integrate with existing ConcurrentQueue

#### Phase 2: UI Updates
1. Remove manual CPU setting
2. Add performance status indicator
3. Update progress bar with new information

#### Phase 3: Fine-Tuning
1. Collect local performance metrics
2. Adjust multipliers based on real-world usage
3. Add user activity detection

#### Phase 4: Advanced Features
1. Smart scheduling for large files
2. Predictive performance adjustment
3. Application-aware throttling (Zoom, Teams, etc.)

### 9. Benefits

#### For Users
- **Zero Configuration**: Works optimally out-of-the-box
- **Better Battery Life**: Automatic reduction on battery power
- **System Stability**: Prevents overheating and excessive resource usage
- **Improved Responsiveness**: Adapts to user activity

#### For System
- **Thermal Management**: Prevents CPU throttling cascade
- **Power Efficiency**: Reduces energy consumption on battery
- **Resource Optimization**: Better utilization of available cores
- **Memory Safety**: Maintains existing memory protections

### 10. Testing Strategy

#### Unit Tests
- Test concurrency calculation with various factor combinations
- Verify minimum concurrency enforcement
- Test factor update logic

#### Integration Tests
- Simulate power state changes
- Mock thermal events
- Test with different CPU core counts

#### Performance Tests
- Measure indexing speed at different concurrency levels
- Track memory usage patterns
- Monitor battery drain rates

#### User Acceptance Tests
- Test on various Mac models (M1, M2, Intel)
- Verify behavior on battery vs AC
- Test during high system load

### 11. Rollback Plan

If issues arise, users can:
1. Set `performance.mode` to `manual` in config
2. Use previous fixed concurrency value
3. Disable specific monitoring features

### 12. Future Enhancements

- **ML-Based Prediction**: Learn user patterns for better scheduling
- **Cloud Sync**: Share optimal settings across devices
- **File Type Prioritization**: Process important files first
- **Network Awareness**: Reduce activity on metered connections
- **Calendar Integration**: Avoid indexing during meetings

## Implementation Timeline

- **Week 1**: Core AdaptivePerformanceManager implementation
- **Week 2**: Power and thermal monitoring integration
- **Week 3**: UI updates and testing
- **Week 4**: Performance tuning and documentation

## Success Metrics

- Battery life improvement: >20% increase during indexing
- Thermal events: <5% of indexing time in thermal throttling
- User satisfaction: No manual intervention needed
- System responsiveness: UI remains smooth during indexing