import { Characteristic, CharacteristicValue, type Logging, PlatformAccessory, Service } from 'homebridge';
import { HomebridgeCreateCeilingFan, PlatformAccessoryContext } from './platform.js';
import type TuyaDevice from 'tuyapi';
import TuyAPI from 'tuyapi';

// HomeKit colour temperature range in Mireds (153=cool/white, 370=warm)
const CCT_MIN_MIREDS = 153;
const CCT_MAX_MIREDS = 370;

export class FanAccessory {
  private readonly fanService: Service;
  private readonly lightService: Service;
  private readonly Characteristic: typeof Characteristic;
  private readonly log: Logging;
  private readonly tuyaDevice: TuyaDevice;
  private isConnecting = false;
  private isConnected = false;
  private fanState = {
    Active: 0 as CharacteristicValue, // 0 = Inactive, 1 = Active
    Rotation: 0 as CharacteristicValue, // 0 = Clockwise, 1 = Counter-Clockwise
    Speed: 20,
  };
  private lightState = {
    On: false,
    ColorTemperature: CCT_MAX_MIREDS, // default warm
  };

  constructor(
    private readonly platform: HomebridgeCreateCeilingFan,
    private readonly accessory: PlatformAccessory<PlatformAccessoryContext>,
  ) {
    this.Characteristic = this.platform.Characteristic;
    this.log = this.platform.log;

    this.log.info(`${accessory.displayName}:`, 'Init...');

    // Information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, 'CREATE')
      .setCharacteristic(this.Characteristic.Model, 'Ceiling Fan')
      .setCharacteristic(this.Characteristic.Name, accessory.context.device.name)
      .setCharacteristic(this.Characteristic.SerialNumber, accessory.context.device.id);

    // Fan
    this.fanService = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2);
    this.fanService.setCharacteristic(this.Characteristic.Name, accessory.context.device.name);
    this.fanService.getCharacteristic(this.Characteristic.Active)
      .onGet(this.getFanActivity.bind(this))
      .onSet(this.setFanActivity.bind(this));

    this.fanService.getCharacteristic(this.Characteristic.RotationDirection)
      .onGet(this.getFanRotation.bind(this))
      .onSet(this.setFanRotation.bind(this));

    this.fanService.getCharacteristic(this.Characteristic.RotationSpeed)
      .onGet(this.getFanSpeed.bind(this))
      .onSet(this.setFanSpeed.bind(this))
      .setProps({ minValue: 0, maxValue: 100, minStep: 20 });

    // Light — remove stale Switch service from cache if present
    const staleSwitch = this.accessory.getService(this.platform.Service.Switch);
    if (staleSwitch) {
      this.accessory.removeService(staleSwitch);
    }

    this.lightService = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);
    this.lightService.setCharacteristic(this.Characteristic.Name, `${accessory.context.device.name} Light`);
    this.lightService.getCharacteristic(this.Characteristic.On)
      .onGet(this.getLightOn.bind(this))
      .onSet(this.setLightOn.bind(this));
    this.lightService.getCharacteristic(this.Characteristic.ColorTemperature)
      .onGet(this.getLightColorTemperature.bind(this))
      .onSet(this.setLightColorTemperature.bind(this))
      .setProps({ minValue: CCT_MIN_MIREDS, maxValue: CCT_MAX_MIREDS });

    this.tuyaDevice = new TuyAPI({
      id: accessory.context.device.id,
      key: accessory.context.device.key,
      ip: accessory.context.device.ip,
      version: accessory.context.device.version,
    });
    this.tuyaDevice.on('disconnected', () => {
      this.log.info(`${this.accessory.displayName}:`,'Disconnected');
      this.isConnected = false;
      this.connect();
    });
    this.tuyaDevice.on('connected', () => {
      this.log.info(`${this.accessory.displayName}:`,'Connected!');
      this.isConnected = true;
    });
    this.tuyaDevice.on('error', (error: Error) => this.log.warn(`${this.accessory.displayName}:`,`Error -> ${error.toString()}`));
    this.connect();
  }

  async connect() {
    if (this.isConnecting || this.isConnected) {
      return;
    }
    this.isConnecting = true;
    this.log.info(`${this.accessory.displayName}:`, 'Connecting...');
    try {
      await this.tuyaDevice.find();
      await this.tuyaDevice.connect();
    } catch (error) {
      this.log.warn(`${this.accessory.displayName}:`, `Connection failed: ${(error as Error).message}. Retrying in 30s...`);
      this.isConnecting = false;
      setTimeout(() => this.connect(), 30_000);
      return;
    }
    this.isConnecting = false;
  }

  sendCommand(dps: number, value: string | number | boolean) {
    this.log.debug(`${this.accessory.displayName}:`, `sendCommand(${dps}, ${value})`);
    this.tuyaDevice.set({ dps, set: value, shouldWaitForResponse: false });
  }

  // DPS 23: 0 (warm) → 1000 (white/cool)  ↔  Mireds: 370 (warm) → 153 (cool)
  private miredsToTuya(mireds: number): number {
    return Math.round((CCT_MAX_MIREDS - mireds) / (CCT_MAX_MIREDS - CCT_MIN_MIREDS) * 1000);
  }

  private tuyaToMireds(tuya: number): number {
    return Math.round(CCT_MAX_MIREDS - (tuya / 1000) * (CCT_MAX_MIREDS - CCT_MIN_MIREDS));
  }

  getFanActivity() {
    this.log.debug(`${this.accessory.displayName}:`, `getFanActivity() => ${this.fanState.Active === 0 ? 'INACTIVE' : 'ACTIVE'}`);
    return this.fanState.Active;
  }

  setFanActivity(value: CharacteristicValue) {
    this.fanState.Active = value as number;
    this.sendCommand(60, this.fanState.Active === 1);
    this.log.debug(`${this.accessory.displayName}:`, `setFanActivity() => ${value === 0 ? 'INACTIVE' : 'ACTIVE'}`);
  }

  getLightOn() {
    this.log.debug(`${this.accessory.displayName}:`, `getLightOn() => ${this.lightState.On ? 'ON' : 'OFF'}`);
    return this.lightState.On;
  }

  setLightOn(value: CharacteristicValue) {
    this.lightState.On = value as boolean;
    this.sendCommand(20, this.lightState.On);
    this.log.debug(`${this.accessory.displayName}:`, `setLightOn() => ${this.lightState.On ? 'ON' : 'OFF'}`);
  }

  getLightColorTemperature() {
    this.log.debug(`${this.accessory.displayName}:`, `getLightColorTemperature() => ${this.lightState.ColorTemperature} mireds`);
    return this.lightState.ColorTemperature;
  }

  setLightColorTemperature(value: CharacteristicValue) {
    this.lightState.ColorTemperature = value as number;
    this.sendCommand(23, this.miredsToTuya(this.lightState.ColorTemperature));
    this.log.debug(`${this.accessory.displayName}:`, `setLightColorTemperature() => ${value} mireds (DPS 23=${this.miredsToTuya(value as number)})`);
  }

  getFanRotation() {
    this.log.debug(`${this.accessory.displayName}:`, `getFanRotation() => ${this.fanState.Rotation === 0 ? 'CLOCKWISE' : 'COUNTER_CLOCKWISE'}`);
    return this.fanState.Rotation;
  }

  setFanRotation(value: CharacteristicValue) {
    this.fanState.Rotation = value as number;
    this.sendCommand(63, this.fanState.Rotation === 0 ? 'forward' : 'reverse');
    this.log.debug(`${this.accessory.displayName}:`, `setFanRotation() => ${value === 0 ? 'CLOCKWISE' : 'COUNTER_CLOCKWISE'}`);
  }

  getFanSpeed() {
    this.log.debug(`${this.accessory.displayName}:`, `getFanSpeed() => ${this.fanState.Speed}`);
    return this.fanState.Speed;
  }

  setFanSpeed(value: CharacteristicValue) {
    if (value === 0) {
      this.fanState.Active = 0;
      this.fanService.updateCharacteristic(this.Characteristic.Active, this.fanState.Active);
      this.sendCommand(60, false);
    } else {
      this.fanState.Speed = value as number;
      this.sendCommand(62, this.toStep(this.fanState.Speed));
    }
    this.log.debug(`${this.accessory.displayName}:`, `setFanSpeed() => ${value}`);
  }

  toStep(percent: number) {
    return Math.round(percent / 20);
  }
}
