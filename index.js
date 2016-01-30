/**
 * Created by riggs on 1/16/16.
 */
"use strict";

var intel_hex = require("intel-hex");

var CONNECTION_ID = null;

var UPLOADING = false;

var POLLER_ID = null;

var ui = {
    device_selector: null,
    connect: null,
    disconnect: null,
    select_file: null,
    file_path: null,
    upload: null,
    receive: null,
    raw: null,
    report_ID_selector: null,
    get_feature: null,
    input_value: null,
    //data_type: null,
    send_input: null,
    set_feature: null,
    log: null,
};

// TODO: Add/remove fields, each with own data type & multiple values of same type.
let _data_types = {
    Uint8: {bits: 8, from: Uint8Array},
    Uint16: {bits: 16, from: Uint16Array},
    Uint32: {bits: 32, from: Uint32Array},
    Uint64: {bits: 64, from: Uint64Array},
    Int8: {bits: 8, from: Int8Array},
    Int16: {bits: 16, from: Int16Array},
    Int32: {bits: 32, from: Int32Array},
    Int64: {bits: 64, from: Int64Array},
    Float32: {bits: 32, from: Float32Array},
    Float64: {bits: 64, from: Float64Array},
};

var Uint64Array = {
    from: array => {
        //TODO
    }
};

var Int64Array = {
    from: array => {
        //TODO
    }
};

var initializeWindow = function () {
    for (var k in ui) {
        var element = document.getElementById(k);
        if (!element) {
            throw "Missing UI element: " + k;
        }
        ui[k] = element;
    }
    enableIOControls(false);
    ui.connect.addEventListener('click', onConnectClicked);
    ui.disconnect.addEventListener('click', onDisconnectClicked);
    ui.select_file.addEventListener('click', onSelectFileClicked);
    ui.upload.addEventListener('click', onUploadClicked);
    ui.receive.addEventListener('change', receive_changed);
    ui.get_feature.addEventListener('click', get_feature_report);
    ui.send_input.addEventListener('click', send_input_clicked);
    ui.set_feature.addEventListener('click', set_feature_report_clicked);
    enumerateDevices();
};

var enableIOControls = function (ioEnabled) {
    ui.device_selector.disabled = ioEnabled;
    ui.connect.style.display = ioEnabled ? 'none' : 'inline';
    ui.disconnect.style.display = ioEnabled ? 'inline' : 'none';
    ui.upload.disabled = ui.file_path.innerText === "" ? true : !ioEnabled;
    ui.receive.checked = ioEnabled ? ui.receive.checked : false;
    ui.receive.disabled = !ioEnabled;
    ui.get_feature.disabled = !ioEnabled;
    ui.send_input.disabled = !ioEnabled;
    ui.set_feature.disabled = !ioEnabled;
};

var logger = function (message) {
    ui.log.textContent += (message + "\n");
    ui.log.scrollTop = ui.log.scrollHeight;
};

function hex_parser (buffer) {
    return Array.from(new Uint8Array(buffer))
        .map(function(i) {
            return Number.prototype.toString.call(i, 16).toUpperCase();
        })
        .join(" ");
}
window.hex_parser = hex_parser;

function string_parser (buffer) {
    return new TextDecoder('utf-8').decode(buffer);
}

function hex_encoder (string) {
    console.log(string);
    // Remove spaces, commas, 0x prefixes.
    let hex_string = string.replace(/[ ,]|(0x)/g, "");

    if (hex_string.length % 2) {
        throw new TypeError("Invalid Hex input.");
    }
    console.log(hex_string);

    let buffer = new ArrayBuffer(hex_string.length / 2);
    var hex = new Uint8Array(buffer);

    for (var i=0; i < hex_string.length; i += 2) {
        var value = parseInt(hex_string.slice(i, i+2), 16);
        if (isNaN(value)) {
            throw new TypeError("Invalid Hex input.");
        }
        hex[i/2] = value;
    }
    return buffer
}

function number_encoder (string) {
    let value = Number(string);
    if (Number.isNaN(value)) {
        throw new TypeError("Invalid Number input.");
    }
    console.log(value);

    let buffer = new ArrayBuffer(4);
    new Float32Array(buffer)[0] = value;

    return buffer;
}

function string_encoder (string) {
    let string_buffer = new TextEncoder('utf-8').encode(string);
    console.log(hex_parser(string_buffer));
    let buffer = new ArrayBuffer(string_buffer.byteLength + 1);
    new DataView(buffer).setUint8(0, string_buffer.byteLength);
    new Uint8Array(buffer, 1).set(new Uint8Array(string_buffer));
    console.log(hex_parser(buffer));
    return buffer;
}

var enumerateDevices = function () {
    chrome.hid.getDevices({}, onDevicesEnumerated);
    chrome.hid.onDeviceAdded.addListener(onDeviceAdded);
    chrome.hid.onDeviceRemoved.addListener(onDeviceRemoved);
};

var onDevicesEnumerated = function (devices) {
    if (chrome.runtime.lastError) {
        console.error("Unable to enumerate devices: " +
            chrome.runtime.lastError.message);
        return;
    }

    for (var device of devices) {
        onDeviceAdded(device);
    }
};

var onDeviceAdded = function (device) {
    if (UPLOADING) {
		console.log("Connectiong to bootloader.");
        chrome.hid.connect(device.deviceId, connectInfo => {
			console.log("Connected to bootloadr.");
            CONNECTION_ID = connectInfo.connectionId;
        });
        return;
    }
    logger("Device detected.");
    var optionId = 'device-' + device.deviceId;
    if (ui.device_selector.namedItem(optionId)) {
        return;
    }

    var selectedIndex = ui.device_selector.selectedIndex;
    var option = document.createElement('option');
    option.text = "Device #" + device.deviceId + " [" +
        device.vendorId.toString(16) + ":" +
        device.productId.toString(16) + "]";
    option.id = optionId;
    option.device = device;
    ui.device_selector.options.add(option);
    if (selectedIndex != -1) {
        ui.device_selector.selectedIndex = selectedIndex;
    }
};

var onDeviceRemoved = function (deviceId) {
    logger("Device Removed.");
    var option = ui.device_selector.options.namedItem('device-' + deviceId);
    if (!option) {
        return;
    }

    if (option.selected) {
        onDisconnectClicked();
    }
    ui.device_selector.remove(option.index);
};

var onConnectClicked = function () {
    var selectedItem = ui.device_selector.options[ui.device_selector.selectedIndex],
        device = selectedItem.device;
    if (!selectedItem) {
        return;
    }
    var deviceId = parseInt(selectedItem.id.substr('device-'.length), 10);
    if (!deviceId) {
        return;
    }
    chrome.hid.connect(deviceId, function (connectInfo) {
        if (!connectInfo) {
            console.log("Unable to connect to device.");
            return;
        }
        CONNECTION_ID = connectInfo.connectionId;

        // device.collections : array of 'collection' objects, collections of report descriptors
        device.collections.forEach(collection => {
            // collection.reportIds : array of report_ID integers
            collection.reportIds.forEach(report_ID => {
                var option = document.createElement('option');
                option.text = report_ID;
                ui.report_ID_selector.options.add(option);
            });
        });
        ui.report_ID_selector.selectedIndex = 0;

        logger("Connected to [" +
            selectedItem.device.vendorId.toString(16) + ":" + selectedItem.device.productId.toString(16) +
            "] on ID " + CONNECTION_ID);
        enableIOControls(true);
    });
};

var onDisconnectClicked = function () {
    if (CONNECTION_ID === null) {
        return;
    }
    if (POLLER_ID) {clearTimeout(POLLER_ID);}
    chrome.hid.disconnect(CONNECTION_ID, function () {
        CONNECTION_ID = null;
    });
    ui.report_ID_selector.length = 0;
    logger("Disconnected ID " + CONNECTION_ID);
    enableIOControls(false);
};

var clearFileUI = function () {
    ui.upload.disabled = true;
    ui.file_path.innerText = "";
};

var onSelectFileClicked = function () {
    clearFileUI();
    chrome.fileSystem.chooseEntry({accepts: [{extensions: ["hex"]}]}, function (entry) {
        if (!entry) {
            return;
        }
        if (CONNECTION_ID != null) {
            ui.upload.disabled = false;
        }

        chrome.fileSystem.getDisplayPath(entry, function (displayPath) {
            ui.file_path.innerText = displayPath;
        });

        // use local storage to retain access to this file
        chrome.storage.local.set({'chosenFile': chrome.fileSystem.retainEntry(entry)});
    });
};

function receive_changed () {
    if (CONNECTION_ID === null) {
        enableIOControls(false);
        clearTimeout(POLLER_ID);
        return;
    }
    if (ui.receive.checked === true) {
        var parser = ui.raw.checked ? hex_parser : string_parser;
        chrome.hid.receive(CONNECTION_ID, (report_ID, buffer) => {
            logger(report_ID + ": " + parser(buffer));
            POLLER_ID = setTimeout(receive_changed, 0);
        })
    } else {
        clearTimeout(POLLER_ID);
    }
}

function get_feature_report () {
    let report_ID = Number(ui.report_ID_selector.options[ui.report_ID_selector.selectedIndex].text);
    if (!report_ID) {return}

    chrome.hid.receiveFeatureReport(CONNECTION_ID, report_ID, buffer => {
        let parser = ui.raw.checked ? hex_parser : string_parser;
        // First number is string length.
        logger(parser(buffer));
    });
}

function _send_report(report_function) {
    let report_ID = Number(ui.report_ID_selector.options[ui.report_ID_selector.selectedIndex].text);
    let input_text = ui.input_value.value;

    var buffer = null;

    try {
        buffer = hex_encoder(input_text);
    } catch (e) {
        try {
            buffer = number_encoder(input_text);
        } catch (e) {
            try {
                buffer = string_encoder(input_text);
            } catch (e) {
                logger(e);
                throw e;
                return;
            }
        }
    }

    report_function.call(chrome.hid, CONNECTION_ID, report_ID, buffer, () => {
        logger("Sent on " + report_ID + ": " + hex_parser(buffer));
    })
}

function send_input_clicked () {
    _send_report(chrome.hid.send);
}

function set_feature_report_clicked () {
    _send_report(chrome.hid.sendFeatureReport)
}

var onUploadClicked = function () {
    chrome.storage.local.get('chosenFile', function (items) {
        if (items.chosenFile === undefined) {
            clearFileUI();
            return;
        }
        // if an entry was retained earlier, see if it can be restored
        chrome.fileSystem.isRestorable(items.chosenFile, function (bIsRestorable) {
            if (!bIsRestorable) {
                clearFileUI();
                return;
            }
            // the entry is still there, load the content
            chrome.fileSystem.restoreEntry(items.chosenFile, function (entry) {
                if (!entry) {
                    logger("Failed to load file.");
                    clearFileUI();
                    return;
                }
                upload_firmware(entry);
            });
        });
    });
};

function upload_firmware(file_data) {
    // Read in Intel-Hex text from file
    readAsText(file_data, function (text) {
        chrome.fileSystem.getDisplayPath(file_data, function (displayPath) {
            logger("Parsed " + displayPath);
        });
        var firmware = intel_hex.parse(text);
        var selectedItem = ui.device_selector.options[ui.device_selector.selectedIndex];
        var device = selectedItem.device;
        var device_info = get_device_info(device.vendorId, device.productId);
        var report_data = new ArrayBuffer(8);

        // Write to report to trigger bootloader.
		console.log("Triggering bootloader");
		console.log(chrome.runtime.lastError);
        chrome.hid.sendFeatureReport(CONNECTION_ID, 255, report_data, () => {
			console.log(chrome.runtime.lastError);
			console.log("Waiting for connection to reset");
            UPLOADING = true;
            //chrome.hid.disconnect(CONNECTION_ID, () => {
			
                CONNECTION_ID = null;
                send_firmware_data(device_info, 0, firmware.data);
			//});
        });
    });
}

function send_firmware_data(device_info, address, data_Buffer) {
	console.log("called send_firmware_data");
    if (CONNECTION_ID === null) {
        setTimeout(() => {send_firmware_data(device_info, address, data_Buffer)}, 500);
        return;
    }
    // Bootloader page data should be the starting address to program,
    // then one device's flash page worth of data.
    var memory_page = new ArrayBuffer(2 + device_info.page_size);

    // Create a view that will address single bytes.
    var view = new Uint8Array(memory_page);

    // Send a final page with an address of 0xFFFF and all 0's for data.
    if (address > data_Buffer.length) {
        view[0] = 0xFF;
        view[1] = 0xFF;
        chrome.hid.send(CONNECTION_ID, 0, memory_page, () => {
			console.log(chrome.runtime.lastError);
            logger("Firmware transmission finished.");
        });
        UPLOADING = false;
        return;
    }
    // Devices with more than 64KB of flash should shift down the page
    // address so that it is 16-bit (page size is guaranteed to be
    // >= 256 bytes so no non-zero address bits are discarded)
    var page_address = device_info.flash_kb < 64 ? address : address >> 8;
    view[0] = page_address;
    view[1] = page_address >> 8;

    // Copy data from firmware Buffer into memory_page to send.
    for (var i=0; i < device_info.page_size; ++i) {
        view[i+2] = data_Buffer[address + i];
    }

    chrome.hid.send(CONNECTION_ID, 0, memory_page, () => {
		console.log(chrome.runtime.lastError);
        logger("Wrote page address " + address.toString(16));
        setTimeout(() => {send_firmware_data(device_info, address + device_info.page_size, data_Buffer)}, 0);
    });
}

function errorHandler(e) {
    console.error(e);
    clearFileUI();
}

function readAsText(file_entry, callback) {
    file_entry.file(function (file) {
        var reader = new FileReader();

        reader.onerror = errorHandler;
        reader.onload = function (e) {
            callback(e.target.result);
        };

        reader.readAsText(file);
    });
}

function get_device_info(vendorID, productID) {
    var device_info_map = {
        at90usb1287: {'page_size': 256, 'flash_kb': 128},
        at90usb1286: {'page_size': 256, 'flash_kb': 128},
        at90usb647 : {'page_size': 256, 'flash_kb': 64},
        at90usb646 : {'page_size': 256, 'flash_kb': 64},
        atmega32u4 : {'page_size': 128, 'flash_kb': 32},
        atmega32u2 : {'page_size': 128, 'flash_kb': 32},
        atmega16u4 : {'page_size': 128, 'flash_kb': 16},
        atmega16u2 : {'page_size': 128, 'flash_kb': 16},
        at90usb162 : {'page_size': 128, 'flash_kb': 16},
        atmega8u2  : {'page_size': 128, 'flash_kb': 8},
        at90usb82  : {'page_size': 128, 'flash_kb': 8},
    };
    return device_info_map['atmega32u4'];
}

window.addEventListener('load', initializeWindow);
