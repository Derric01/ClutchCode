"""Tests for stats.mean."""

import pytest

from stats import mean


def test_mean_of_integers():
    assert mean([1, 2, 3]) == 2


def test_mean_rejects_empty():
    with pytest.raises(ValueError):
        mean([])
