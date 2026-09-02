"""Tests for stats.median."""

import pytest

from stats import median


def test_median_odd_length():
    assert median([3, 1, 2]) == 2


def test_median_even_length():
    assert median([4, 1, 3, 2]) == 2.5


def test_median_of_unsorted_input():
    assert median([9, 1, 7, 3, 5]) == 5


def test_median_rejects_empty():
    with pytest.raises(ValueError):
        median([])
