import unittest

from calc import add, double


class CalcTest(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(1, 2), 3)

    def test_double(self):
        self.assertEqual(double(2), 4)


if __name__ == "__main__":
    unittest.main()
