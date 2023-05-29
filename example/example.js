const fs = require('fs');
const SerialPort = require('serialport')
const YModem = require('ymodem');

const port = new SerialPort('COM4', { autoOpen: false, baudRate: 1000000 })
const firmware = './UserApp.sfb';

function handler(data) {
    const now = timestamp()
    if (data.length == 1 && data.includes(0x06))
        var data_str = ['ACK']
    else if (data.length == 1 && data.includes(0x15))
        var data_str = ['NAK']
    else
        var data_str = data.toString().trim().split(/\r?\n/)
    data_str.forEach(item => console.log(now, '>>', item.trim()))
}

function open() {
    port.open(function (err) {
        if (err) {
            return console.log(timestamp(), '--', 'Error opening port: ', err.message)
        }
    })
}

function close() {
    port.close(function (err) {
        if (err) {
            return console.log(timestamp(), '--', 'Error closing port: ', err.message)
        }
    })
}

function send(data) {
    const now = timestamp()
    port.write(data + '\r\n', function (err) {
        if (err) {
            return console.log(now, '--', 'Error on write: ', err.message, 'data: "', data, '"')
        }
        console.log(now, '<<', data.trim())
    })
}

function sleep(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}

function timestamp() {
    const date = new Date()
    const time = date.toLocaleTimeString("en-US", { hour12: false })
    const millis = ('000' + date.getMilliseconds()).slice(-3)
    return time + '.' + millis
}

async function example() {
    port.on('open', function () {
        port.set({ dtr: true, rts: true, })
        console.log(timestamp(), '--', 'Port', port.path, 'opened')
    })
    
    port.on('close', function () {
        console.log(timestamp(), '--', 'Port', port.path, 'closed')
    })
    
    port.on('error', function (err) {
        console.log(timestamp(), '--', 'Error:', err.message)
    })
    port.on('data', handler)
    open()
    await sleep(1000)
    send('VERB=2')
    await sleep(5000)
    send('FUPD')
    // await sleep(10000)
    timeout = 10000
    port.removeListener('data', handler);
    await YModem.transfer(port, firmware, fs.readFileSync(firmware), timeout)
        .then((result) => {
            if (result && result.totalBytes == result.writtenBytes) {
                console.log('file transfer successful')
            } else {
                console.log('file transfer error')
            }
        })
        .catch((err) => {
            console.log(err)
        });
    port.on('data', handler);
    await sleep(10000)
    close()
}

example()