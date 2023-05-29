/*
 * Based on:
 * https://github.com/ppvision/SerialApp/blob/main/src/Modules/ymodem.js
 */

const PACKET_SIZE_128 = 128;
const PACKET_SIZE_1024 = 1024;
const SOH = 0x01; // 128 byte blocks
const STX = 0x02; // 1K blocks
const EOT = 0x04; // end of transfer
const ACK = 0x06; // response
const NAK = 0x15; // no response
const CA = 0x18; // 24 transmission aborted
const CRC16 = 0x43; // 67 "C"
const ABORT1 = 0x41 // 65
const ABORT2 = 0x61 // 97

var eot_pack = Buffer.alloc(PACKET_SIZE_128 + 5, 0x00);
eot_pack[0] = SOH;
eot_pack[2] = 0xff;
// crc == 0

/* 
 * YModem uses CRC16-CCITT European version of the CRC checksum, 
 * its generator polynomial is：x16+x12+x5+1
 */
function crc16xmodem(packet, begin, len, previous) {
    let stop_at = begin + len;
    let crc = typeof previous !== 'undefined' ? ~~previous : 0x0;
    for (; begin < stop_at; begin++) {
        let code = (crc >>> 8) & 0xff;
        code ^= packet[begin] & 0xff;
        code ^= code >>> 4;
        crc = (crc << 8) & 0xffff;
        crc ^= code;
        code = (code << 5) & 0xffff;
        crc ^= code;
        code = (code << 7) & 0xffff;
        crc ^= code;
    }
    return crc;
}

function makeFileHeader(filename, filesize) {
    let File_HD_SIZE = 128
    var payload = Buffer.alloc(File_HD_SIZE + 3 + 2, 0x00);
    payload[0] = SOH;
    payload[1] = 0;
    payload[2] = 0xff;
    var offset = 3;
    if (filename) {
        payload.write(filename, offset);
        offset += filename.length + 1;
    }
    if (filesize) {
        payload.write(filesize.toString() + " ", offset);
    }
    var crc = crc16xmodem(payload, 3, File_HD_SIZE);
    payload.writeUInt16BE(crc, payload.byteLength - 2);
    return payload;
}

function splitFile(buffer) {
    let totalBytes = buffer.byteLength;
    let maxPack = parseInt((buffer.byteLength + PACKET_SIZE_1024 - 1) / PACKET_SIZE_1024);
    var array = [];
    for (let i = 0; i < maxPack; i++) {
        let is_last = (i + 1) == maxPack ? true : false;
        let packSize = PACKET_SIZE_1024;
        if (is_last && totalBytes - i * PACKET_SIZE_1024 <= 128) {
            packSize = PACKET_SIZE_128;
        }
        var chunk = Buffer.alloc(packSize + 3 + 2, is_last ? 0x1A : 0x00);

        chunk[0] = (packSize == PACKET_SIZE_1024) ? STX : SOH;
        chunk[1] = (i + 1) & 0xff;
        chunk[2] = 0xff - chunk[1];

        buffer.copy(chunk, 0 + 3, PACKET_SIZE_1024 * i, PACKET_SIZE_1024 * i + packSize);
        var crc = crc16xmodem(chunk, 3, packSize);
        chunk.writeUInt16BE(crc, chunk.byteLength - 2);
        array.push(chunk);
    }
    // eslint-disable-next-line
    return array;
}

function splitBuffer(buffer, size) {
    let totalBytes = buffer.byteLength;
    let maxPack = parseInt((buffer.byteLength + size - 1) / size);
    var array = [];
    for (let i = 0; i < maxPack; i++) {
        let is_last = (i + 1) == maxPack ? true : false;
        let packSize = size;
        if (is_last) {
            packSize = totalBytes % size;
        }
        var chunk = Buffer.alloc(packSize, 0x00);
        buffer.copy(chunk, 0, size * i, size * i + packSize);
        array.push(chunk);
    }
    // eslint-disable-next-line
    // debugger
    return array;
}

exports.transfer = function transfer(serial, filename, buffer, logger = console.log) {
    // eslint-disable-next-line
    return new Promise((resolve, reject) => {
        var file_trunks = [];
        var totalBytes = 0;
        var writtenBytes = 0;
        var seq = 0;
        var session = false;
        var sending = false;
        var finished = false;

        // convert Uint8Array to Buffer
        buffer = Buffer.from(buffer.buffer);

        async function sendBuffer(buffer, once_len = 0) {
            if (!once_len) {
                return await serial.write(buffer, "binary");
            }
            async function bulk() {
                var chunks = splitBuffer(buffer, once_len);
                for (const chunk of chunks) {
                    var arr = new Uint8Array(chunk.buffer);
                    await serial.write(arr, "binary");
                }
            }
            return await bulk();
        }

        // Send packet
        async function sendPacket() {
            logger(`sendPacket seq:${seq}/${file_trunks.length}  \r`);
            if (seq < file_trunks.length) {
                var packet = file_trunks[seq];
                await sendBuffer(packet);
            } else {
                if (sending) {
                    await sendBuffer(Buffer.from([EOT]));
                }
            }
        }

        // Handler for data from Ymodem
        function handler(data) {
            let PreChar = 0;
            for (var i = 0; i < data.byteLength; i++) {
                if (!finished) {
                    var ch = data[i];
                    if (ch === CRC16) {
                        logger(`RCV: C @${seq}`);
                        if (seq >= file_trunks.length) {
                            logger(`SEND EOT @${seq}`);
                            sendBuffer(eot_pack);
                        }
                        else if (PreChar != CRC16) {
                            sendPacket();
                            sending = true;
                        }
                    } else if (ch === ACK) {
                        logger(`RCV: ACK @${seq}`);
                        if (!session) {
                            close();
                        }
                        if (sending) {
                            if (seq == 0) {//HEADER ACK ;DATA PACK followed by next C
                                seq++;
                            }
                            else if (seq < file_trunks.length) {
                                if (writtenBytes < totalBytes) {
                                    writtenBytes = (seq + 1) * PACKET_SIZE_1024;
                                    if (writtenBytes > totalBytes) {
                                        writtenBytes = totalBytes;
                                    }
                                }
                                seq++;
                                sendPacket();
                            } else {
                                /* send complete */
                                sending = false;
                                session = false;
                                // send null header for end of session
                                logger(`SEND EOT @${seq}`);
                                sendBuffer(eot_pack);
                            }
                        }
                    } else if (ch === NAK) {
                        sendPacket();
                    } else if (ch === CA) {
                        logger(`RCV: CA @${seq}`);
                        close("CA");
                    }
                    PreChar = ch;
                }
            }
        }

        // Finish transmittion
        function close(ch = '') {
            session = false;
            sending = false;
            serial.removeListener("data", handler);
            logger(`CLOSE BY [${ch}]`);
            if (!finished) {
                const result = {
                    filePath: filename,
                    totalBytes: totalBytes,
                    writtenBytes: writtenBytes,
                };
                resolve(result);
            }
            finished = true;
        }

        // Make file header payload
        totalBytes = buffer.byteLength;
        var headerPayload = makeFileHeader(filename, totalBytes);
        file_trunks.push(headerPayload);

        // Make file data packets
        var payloads = splitFile(buffer);
        payloads.forEach((payload) => {
            file_trunks.push(payload);
        });
        // Start to transfer
        // eslint-disable-next-line
        session = true;
        serial.on("data", handler);
    });
}
