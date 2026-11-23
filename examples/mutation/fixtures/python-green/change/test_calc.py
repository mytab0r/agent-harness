import unittest

from calc import add


class CalcTest(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(1, 2), 3)

    # This test does not assert the changed behavior. Reverting the fix leaves
    # it green on purpose: the universal tier must report NOT-CAUGHT.
    def test_add_two(self):
        self.assertEqual(add(2, 2), 4)


if __name__ == "__main__":
    unittest.main()
