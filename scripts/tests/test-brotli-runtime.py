#!/usr/bin/env python3
"""Run inside the pgAdmin candidate image, without networking or data volumes."""
import ctypes
import importlib.metadata
import io
import unittest

import brotli
import urllib3.response
from urllib3.exceptions import DecodeError
from urllib3.response import HTTPResponse


class BrotliRuntimeTests(unittest.TestCase):
    payload = b'OpenCW Brotli compatibility control\x00' * 8

    @classmethod
    def setUpClass(cls):
        cls.native = ctypes.CDLL('libbrotlidec.so.1')
        cls.native.BrotliDecoderVersion.restype = ctypes.c_uint32
        cls.native.BrotliDecoderErrorString.argtypes = [ctypes.c_int]
        cls.native.BrotliDecoderErrorString.restype = ctypes.c_char_p
        cls.native.BrotliDecoderDecompress.argtypes = [
            ctypes.c_size_t, ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p,
        ]
        cls.native.BrotliDecoderDecompress.restype = ctypes.c_int

    def test_python_binding_is_patched(self):
        version = importlib.metadata.version('Brotli')
        self.assertGreaterEqual(tuple(map(int, version.split('.'))), (1, 2, 1))
        self.assertEqual(brotli.__version__, version)

    def test_system_decoder_is_patched(self):
        encoded = self.native.BrotliDecoderVersion()
        version = (encoded >> 24, (encoded >> 12) & 0xfff, encoded & 0xfff)
        self.assertGreaterEqual(version, (1, 2, 1))

    def test_block_switch_patch_is_present(self):
        # This error was introduced by Google's CVE-2026-111497 fix.
        self.assertEqual(self.native.BrotliDecoderErrorString(-17), b'_ERROR_FORMAT_BLOCK_SWITCH')

    def test_python_round_trip(self):
        self.assertEqual(brotli.decompress(brotli.compress(self.payload)), self.payload)

    def test_streaming_round_trip(self):
        decoder = brotli.Decompressor()
        encoded = brotli.compress(self.payload)
        decoded = b''.join(decoder.process(bytes([byte])) for byte in encoded)
        self.assertEqual(decoded, self.payload)
        self.assertTrue(decoder.is_finished())

    def test_http_response_decodes_brotli(self):
        response = HTTPResponse(body=io.BytesIO(brotli.compress(self.payload)),
                                headers={'content-encoding': 'br'},
                                preload_content=True, decode_content=True)
        self.assertEqual(response.data, self.payload)

    def test_http_decoder_uses_the_patched_binding(self):
        self.assertIs(urllib3.response.brotli, brotli)

    def test_malformed_python_input_is_rejected(self):
        for encoded in (b'\xff', b'\xff' * 32):
            with self.subTest(encoded=encoded), self.assertRaises(brotli.error):
                brotli.decompress(encoded)

    def test_malformed_http_input_is_rejected(self):
        with self.assertRaises(DecodeError):
            HTTPResponse(body=io.BytesIO(b'\xff' * 32),
                         headers={'content-encoding': 'br'},
                         preload_content=True, decode_content=True)

    def test_truncated_input_is_rejected(self):
        encoded = brotli.compress(self.payload)[:-1]
        with self.assertRaises(brotli.error):
            brotli.decompress(encoded)
        decoder = brotli.Decompressor()
        decoder.process(encoded)
        self.assertFalse(decoder.is_finished())

    def test_native_round_trip(self):
        encoded = brotli.compress(self.payload)
        source = ctypes.create_string_buffer(encoded)
        output = ctypes.create_string_buffer(len(self.payload))
        size = ctypes.c_size_t(len(output))
        result = self.native.BrotliDecoderDecompress(len(encoded), source,
                                                   ctypes.byref(size), output)
        self.assertEqual(result, 1)
        self.assertEqual(output.raw[:size.value], self.payload)

    def test_native_malformed_input_is_rejected(self):
        source = ctypes.create_string_buffer(b'\xff')
        output = ctypes.create_string_buffer(64)
        size = ctypes.c_size_t(len(output))
        self.assertEqual(self.native.BrotliDecoderDecompress(1, source,
                         ctypes.byref(size), output), 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
