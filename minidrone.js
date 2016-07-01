/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2016 Ricardo Liang
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

/**
 * A connection with a Mini Drone BLE device, using the Web Bluetooth API.
 *
 * @constructor
 */
function MiniDrone() {

  var device = null;
  var characteristics = {};
  var velocity = {x: 0, y: 0, z: 0, w: 0};
  var counters = {fa0a: 0, fa0b: 0, fa0c: 0};

  /**
   * Called when the drone is ready for flying.
   */
  this.onconnected = new Function();

  /**
   * Called when the drone has disconnected.
   */
  this.ondisconnected = new Function();

  /**
   * Creates a function that returns a Promise that resolves after a timespan.
   *
   * @param {Number} ms the time to wait in milliseconds.
   * @return {Function} a function that returns the promise.
   */
  function wait(ms) {
    return function() {
      return new Promise(function(resolve) {
        setTimeout(resolve, ms);
      });
    };
  }

  /**
   * Gets a Mini Drone's BLE GATT service or characteristic's UUID from its
   * unique segment.
   *
   * @param {String} id the unique segment.
   * @return {String} the service or characteristic's UUID.
   */
  function getUUID(id) {
    return '9a66' + id + '-0800-9191-11e4-012d1540cb8e';
  }

  /**
   * Initializes a newly found GATT characteristic.
   *
   * Adds a characteristic to the cache, indexed by its UUID's unique segment.
   *
   * @param {BlueroothRemoteGATTCharacteristic} chr the GATT characteristic.
   */
  function setupCharacteristic(chr) {
    characteristics[chr.uuid.substring(4, 8)] = chr;
  }

  /**
   * Initializes a newly found GATT service.
   *
   * Discovers the service's characteristics and initializes them.
   *
   * @param {BlueroothRemoteGATTService} svc the GATT service.
   * @return {Promise} a promise resolved after all of the service's
   * characteristics have been initialized.
   * @see setupCharacteristic
   */
  function setupService(svc) {
    return svc.getCharacteristics()
    .then(function(chrs) {
      return Promise.all(chrs.map(setupCharacteristic));
    });
  }

  /**
   * Enables notifications for some GATT characteristics.
   *
   * It is necessary to start notifications for some characteristics before
   * flying the drone.
   *
   * @return {Promise} a promise resolved after all necessary notifications
   * have been enabled.
   */
  function setupNotifications() {
    return Promise.all([
      'fb0f', 'fb0e', 'fb1b', 'fb1c',
      'fd22', 'fd23', 'fd24', 'fd52', 'fd53', 'fd54',
    ].map(function(id) {
      return characteristics[id].startNotifications()
      .catch(new Function());
    }));
  }

  /**
   * Initializes the device's GATT server.
   *
   * Discovers GATT services and initializes them.
   *
   * @param {BluetoothRemoteGATTServer} svr the GATT server.
   * @return {Promise} a promise resolved after the relevant services have been
   * initialized.
   * @see setupService
   */
  function setupServer(svr) {
    return Promise.all([
      'fa00', 'fb00', 'fc00', 'fd21', 'fd51', 'fe00',
    ].map(function(id) {
      return svr.getPrimaryService(getUUID(id))
      .then(setupService);
    }));
  }

  /**
   * Initializes the BLE device.
   *
   * Connects to the GATT server and initializes it.
   *
   * @param {BluetoothDevice} dev the device.
   * @return {Promise} a promise resolved after the device has been
   * initialized.
   * @see setupServer
   * @see setupNotifications
   */
  function setupDevice(dev) {
    return (device = dev).gatt.connect()
    .then(setupServer)
    .then(setupNotifications);
  }

  /**
   * Writes a value to a GATT characteristic.
   *
   * Disconnects on failure.
   *
   * @param {String} id the characteristic's UUID's unique segment.
   * @return {Promise} a promise resolved after the value is written.
   */
  function write(id, data) {
    return characteristics[id].writeValue(new Uint8Array(data).buffer)
    .catch(disconnect);
  }

  /**
   * Checks whether the drone is moving along any axis.
   *
   * @return {Boolean} whether the drone is moving.
   */
  function isMoving() {
    for (var axis in velocity)
      if (velocity[axis] !== 0)
        return true;
    return false;
  }

  /**
   * Recursively sends the current velocity values to the device each 50ms.
   *
   * Also prevents the connection from dropping.
   *
   * @return {Promise} a promise resolved after disconnection from the device.
   */
  function updateLoop() {
    if (!device || !device.gatt.connected)
      return;
    return write('fa0a', [
      2, ++counters['fa0a'], 2, 0, 2, 0, isMoving() ? 1 : 0,
      velocity.x, velocity.y, velocity.w, velocity.z,
      0, 0, 0, 0, 0, 0, 0, 0,
    ])
    .then(wait(50))
    .then(updateLoop);
  }

  /**
   * Initializes the BLE device and starts the update loop.
   *
   * @param {Bluetooth} bluetooth=navigator.bluetooth the Web Bluetooth
   * interface.
   * @see setupDevice
   * @see update
   */
  function connect(bluetooth) {
    (bluetooth || navigator.bluetooth)
    .requestDevice({filters: [
      {namePrefix: 'Mars'},
      {namePrefix: 'RS'},
      {namePrefix: 'Travis'},
      {services: ['fa00', 'fb00', 'fd21', 'fd51'].map(getUUID)},
    ]})
    .then(setupDevice)
    .then(wait(100))
    .then(this.onconnected)
    .then(updateLoop)
    .then(this.ondisconnected, this.ondisconnected);
  }
  this.connect = connect.bind(this);

  /**
   * Disconnectes from the BLE device.
   */
  function disconnect() {
    if (device && device.gatt.connected)
      device.gatt.disconnect();
    device = null;
  }
  this.disconnect = disconnect.bind(this);

  /**
   * Instructs to takeoff.
   *
   * @return {Promise} a promise resolved after the command is sent.
   */
  function takeOff() {
    return write('fa0b', [4, ++counters['fa0b'], 2, 0, 1, 0]);
  }
  this.takeOff = takeOff.bind(this);

  /**
   * Instructs to land.
   *
   * @return {Promise} a promise resolved after the command is sent.
   */
  function land() {
    return write('fa0b', [4, ++counters['fa0b'], 2, 0, 3, 0]);
  }
  this.land = land.bind(this);

  /**
   * Instructs to backflip.
   *
   * @return {Promise} a promise resolved after the command is sent.
   */
  function backFlip() {
    return write('fa0b', [4, ++counters['fa0b'], 2, 4, 0, 0, 0, 0, 0, 0]);
  }
  this.backFlip = backFlip.bind(this);

  /**
   * Instructs to flip.
   *
   * @return {Promise} a promise resolved after the command is sent.
   */
  function frontFlip() {
    return write('fa0b', [4, ++counters['fa0b'], 2, 4, 0, 0, 1, 0, 0, 0]);
  }
  this.frontFlip = frontFlip.bind(this);

  /**
   * Instructs to flip rightways.
   *
   * @return {Promise} a promise resolved after the command is sent.
   */
  function rightFlip() {
    return write('fa0b', [4, ++counters['fa0b'], 2, 4, 0, 0, 2, 0, 0, 0]);
  }
  this.rightFlip = rightFlip.bind(this);

  /**
   * Instructs to flip leftways.
   *
   * @return {Promise} a promise resolved after the command is sent.
   */
  function leftFlip() {
    return write('fa0b', [4, ++counters['fa0b'], 2, 4, 0, 0, 3, 0, 0, 0]);
  }
  this.leftFlip = leftFlip.bind(this);

  /**
   * Instructs to emergency land.
   *
   * @return {Promise} a promise resolved after the command is sent.
   */
  function emergencyLand() {
    return write('fa0c', [2, ++counters['fa0c'], 2, 0, 4, 0]);
  }
  this.emergencyLand = emergencyLand.bind(this);

  /**
   * Instructs to hover.
   *
   * Sets the velocity to zero.
   * The actual command is sent during the next update.
   *
   * @see update
   */
  function hover() {
    for (var axis in velocity)
      velocity[axis] = 0;
  }
  this.hover = hover.bind(this);

  /**
   * Instructs to drive with given velocities along the axes.
   *
   * W refers to the rotational velocity.
   * The actual command is sent during the next update.
   *
   * @param {{x: Number, y: Number, z: Number, w: Number}} vel the velocities
   * along each axis.
   * @see update
   */
  function drive(vel) {
    hover();
    for (var axis in velocity)
      velocity[axis] = vel[axis];
  }
  this.drive = drive.bind(this);
}

if (typeof module !== 'undefined')
  module.exports = MiniDrone;
 Á
