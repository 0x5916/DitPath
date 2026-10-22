package configs

import (
	"math"
	"reflect"
	"testing"
)

func TestIsZeroInterfaceValues(t *testing.T) {
	for _, test := range []struct {
		name  string
		value any
		want  bool
	}{
		{"nil interface", nil, true},
		{"interface containing nil pointer", (*int)(nil), false},
		{"interface containing nil slice", []int(nil), false},
		{"interface containing zero", 0, false},
		{"interface containing nonzero", 1, false},
		{"interface containing zero struct", struct{}{}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			value := reflect.ValueOf(&test.value).Elem()
			if got := isZero(value); got != test.want {
				t.Fatalf("isZero(%#v interface) = %v, want %v", test.value, got, test.want)
			}
		})
	}
}

func TestIsZeroAdditionalKinds(t *testing.T) {
	type nested struct {
		State struct{ Count int }
		Array [1]int
		Slice []int
	}
	changed := nested{}
	changed.State.Count = 1
	for _, test := range []struct {
		name  string
		value any
		want  bool
	}{
		{"zero nested struct", nested{}, true},
		{"nonzero nested struct", changed, false},
		{"nested nonzero array", nested{Array: [1]int{1}}, false},
		{"nested allocated empty slice", nested{Slice: []int{}}, false},
		{"zero unsigned integer", uint64(0), true},
		{"nonzero unsigned integer", uint64(1), false},
		{"zero float", float64(0), true},
		{"negative zero float", math.Copysign(0, -1), true},
		{"nonzero float", 0.5, false},
		{"zero complex", complex(0, 0), true},
		{"nonzero complex", complex(0, 1), false},
		{"nil channel", (chan int)(nil), true},
		{"allocated channel", make(chan int), false},
		{"nil function", (func())(nil), true},
		{"non-nil function", func() {}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := isZero(reflect.ValueOf(test.value)); got != test.want {
				t.Fatalf("isZero(%#v) = %v, want %v", test.value, got, test.want)
			}
		})
	}
}
