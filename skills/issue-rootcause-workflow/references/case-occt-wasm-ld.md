# Case Study — OCCT/wasm-ld Signature Mismatch (원칙 #7 의 기원)

이 케이스는 **원칙 #7 "Mechanism trace > blind variation"** 이 어떻게 도출됐는지를 보여준다. 21+ round 의 blind variation 이 모두 0 trigger 였음에도 *"OCCT-specific 한 무엇"* 이라고 결론지었던 게으름. 사용자 push 후 결국 mechanism trace 로 전환 → 1.5h 안에 답.

## TL;DR

| 시점 | 시간 누적 | 진전 |
|---|---|---|
| Round 1–13 (blind variation) | ~2일 | 0 trigger 합성. 결론: "OCCT-specific" |
| 사용자 "OCCT-free 여야 돼" push | — | **모순 신호** (#5) |
| LLVM source clone + sparse checkout | +5분 | lld/wasm/SymbolTable.cpp 식별 |
| `errs()` patch 추가 + ninja lld rebuild | +30분 | wasm-ld 23.0 빌드물 |
| 첫 trace dump | +5분 | **결정적 mechanism 식별** — variant 가 (LTO bitcode side `()->void` ↔ native wasm side `(i64,i64)->void`) 충돌일 때 생성 |
| Minimal 합성 (link order 변형) | +30분 | **26 lines, 4 files, 1 warning** OCCT-free reproducer |
| 합 | ~1.5h | 진정한 source-level OCCT-free |

## Setup

emsdk 5.0.6 (LLVM 23) wasm 빌드에서 `RecordAttr`(TDF_Attribute 상속, DeltaOn{Addition,Forget,Resume} override 안 함) 와 OCCT prebuilt 51 archive 를 link 시 wasm-ld 가 3개 signature mismatch warning emit. 워크어라운드는 가능했지만 진짜 root cause 와 OCCT-free reproducer 가 목표.

## 5 anti-pattern 의 실제 발현

### A. Mechanism trace 미루기

LLVM/lld source 가 *공개* 되어있고 *clone + sparse checkout 5분*. 그러나 처음 13 round 동안 *간접 변형* (Handle template 모양, vtable size, RTTI 매크로, multi-level inheritance) 만 시도. 매 round 가 minimal reproducer 빌드 + link + 결과 0 의 cycle. 누적 ~2일 소비. trace 로 전환했더라면 *1-2 시도* 안에 답.

**교훈**: source 가 알려진 OSS 시스템에서 5+ variation round 가 0 trigger 면 *direct trace 가 거의 항상 빠르다*. clone + 1줄 patch + rebuild 비용 (~30분 ~ 1시간) 이 N variation round 비용 (5–30분 each) 보다 작아지는 임계가 5 round 근방.

### B. "X-specific" 결론 빠르게

13 round 모두 0 → "OCCT 의 5000+ .o 가 만드는 LTO codegen 의 whole-program 결정 이 trigger. 표준 C++ 패턴으로 흉내 불가." 라고 결론. 그러나 이 trigger 는 *standard wasm-ld signature variant logic* — 표준 패턴. 흉내 가능해야 했다.

**교훈**: "X-specific 이라 generic 으로 안 됨" 결론은 거의 항상 변수를 못 짚은 결과. 표준 패턴 (linking, ABI, vtable, format spec) 으로 작동하는 시스템에서 *generic 합성이 본질적으로 불가능* 한 경우는 드물다.

### C. 암묵적 변수 무시

13 round 의 variation axis:
- Handle template 모양 (trivial vs non-trivial ctor, dtor body 사용)
- Vtable slot 수 (4, 30, 31)
- RTTI 매크로 유무
- Multi-level inheritance (Transient ← Base, Standard_Transient mock)
- 30 different forward declared types
- Driver class 수 (1, 17)

전부 *derived TU 의 surface composition* 같은 axis. 결정적 axis 였던 *link order* (eager driver TU + lazy base archive) 는 *암묵 변수* 라 enumerate 안 됨.

**교훈**: variation 공간 정의 시 *표면 변수* (size, count, opt level) 외에 *암묵 변수* (link/build 순서, file/TU boundary, format combo, lazy vs eager, 시점 결정, scope) 를 의식적으로 list. 5+ round 0 trigger 면 *axis 자체* 의심.

### D. 외부 push 없이 멈춤

- "OCCT-specific" 결론 → 사용자에게 보고 → 사용자 "OCCT-free 여야 돼" push → 다시 시도
- "21 round 모두 0. 시간 한도. 한계." → 사용자에게 보고 → 사용자 "한계 그만" push → 다시 시도
- "더 시도 못 함" → 사용자 "OCCT-free가 가능해야 돼. 반드시" push → patched lld 시도 → 답 발견

매번 사용자 push 가 다음 step 을 trigger. push 없이는 멈췄을 것.

**교훈**: mechanism trace 가 *default move* 여야 한다. self-check: "사용자 push 없이도 받아들였을 결론인가? 다음 단일 결정적 step 이 보이는가?" — push 가 필요한 결론은 진짜 결론 아님.

### E. 부피로 노력 합리화

"21 round + IR 직접 합성 + multi-driver 흉내" 라는 *부피* 로 *충분히 시도했다* 라고 self-justify. 그러나 21 round 가 *모두 같은 axis* (derived TU surface composition) 의 N 점 이었다. *다른 axis* 의 1 점만 (link order) 이라도 시도했으면 답 발견.

**교훈**: N round 의 *axis 분포* 를 점검. 같은 axis 의 N 점은 *회피의 다른 형태*. 다른 axis 1 점이 N 같은 axis 점보다 가치 큼.

## 진짜 mechanism (mechanism trace 후 식별)

LLVM source 분석 + `errs()` patched lld 의 dump 결과:

```
[VAR-DUMP] _ZNK13TDF_Attribute15DeltaOnAdditionEv has 2 variants:
  - sig=() -> void          file=RecordAttr.cpp.o  (LTO bitcode)
  - sig=(i64, i64) -> void  file=TDF_Attribute.cxx.o (native wasm)
```

핵심 path (`lld/wasm/SymbolTable.cpp`):

1. `createBitcodeSymbol` — bitcode TU 의 placeholder undefined → `addUndefinedFunction(name, sig=null, isCalledDirectly=true)`
2. native wasm driver TU (eager linked, *base archive 보다 먼저*) → `addUndefinedFunction(name, sig=()->void)` → `existingFunction.signature = ()->void` attach
3. native wasm strong def archive (lazy linked, *나중*) → `addDefinedFunction(name, sig=(i64,i64)->void)` → `checkSig=true` (sticky from #1) → `signatureMatches=false` → `getFunctionVariant` → variant 생성
4. `handleSymbolVariants` 가 link 끝에 mismatch warning 발화

**결정적 변수 = link 순서**. eager driver + lazy base archive 가 sig sequence (null → ()->void → (i64,i64)->void) 만들고, 모두 archive 또는 모두 eager 면 sig sequence 다름 → variant 안 생김.

## Minimal source-level OCCT-free reproducer

mechanism 이해 후 합성한 reproducer — **4 files, 26 lines, 1 warning**:

```cpp
// common.hpp (7 lines)
struct Forward;
template<typename T> struct Handle { T* p = nullptr; };
class Base {
 public:
  virtual ~Base() = default;
  virtual Handle<Forward> Inherited() const;
};
```

```cpp
// base.cpp (9 lines) — strong def, native wasm, packed into libbase.a (LAZY)
#include "common.hpp"
struct Forward { int x; };
extern "C" __attribute__((noinline)) void anchor(const Base* p) {
  asm volatile("" : : "r"(p) : "memory");
}
Handle<Forward> Base::Inherited() const {
  anchor(this);  // keeps `this` arg → wasm function type (i64, i64) -> void
  return {};
}
```

```cpp
// driver.cpp (4 lines) — placeholder reference TU, native wasm (EAGER)
#include "common.hpp"
class Driver : public Base { public: ~Driver() override; };
Driver::~Driver() {}  // out-of-line dtor anchors vtable
extern "C" void* make_driver() { return new Driver(); }
```

```cpp
// derived.cpp (6 lines) — LTO bitcode TU
#include "common.hpp"
class MyDerived : public Base { public: ~MyDerived() override; };
MyDerived::~MyDerived() {}
extern "C" void* make_driver();
extern "C" int run() { return make_driver() ? 0 : 1; }
extern "C" Base* make_derived() { return new MyDerived(); }
```

**Critical link order**:
```bash
em++ -O3 -flto ... derived.bc driver.o libbase.a
#                  ^^^^^^^^^^ ^^^^^^^^  ^^^^^^^^^^
#                  LTO bitcode  eager   lazy archive
```

이 순서를 뒤집거나 (`derived.bc libbase.a driver.o`) 모두 같은 archive 에 packing 하면 **trigger 0**. 즉 *link 순서* 가 결정적 변수 — 13 round 동안 enumerate 안 됐던 *암묵 변수*.

## 일반화

이 케이스에서 추출되는 워크플로 규칙 (#7 의 본질):

1. **5+ round 0 trigger** → *현재 변형 axis* list + *안 건드린 axis* enumerate
2. **OSS 시스템 + 5+ round 0** → mechanism trace 시작 (`errs()` patch + rebuild)
3. **"X-specific" / "한계" 결론 직전** → 다음 단일 결정적 step self-check
4. **사용자 push 후에야 진전** → workflow 자체 실패. mechanism trace 를 default move 로

자세한 발동 신호 + 적용 방법 + anti-pattern 분석: [principles.md §7](principles.md), [principles.md §8](principles.md).

## 자매 case study

[case-llvm-vtk.md](case-llvm-vtk.md) — LLVM PR #194184 검증. 두 case 모두 **#5 모순 신뢰** 가 결정적 turning point:

| Case | 모순 신호 | 발견 시점 |
|---|---|---|
| LLVM/VTK | "baseline 이 통과해서는 안 되는데 통과함" | 사용자 한 줄 질문 ("도달 검증 했어?") |
| OCCT/wasm-ld | "표준 패턴 (vtable + linking) 인데 generic 흉내 불가능" | 사용자 한 줄 질문 ("OCCT-free 여야 돼") |

차이: VTK case 는 *결과 모순* (실험 셋업 의심으로 #5 직결), OCCT case 는 *변수 list 모순* (#8 self-doubt 의 form). 둘 다 *외부 push 없이 받아들였을 결론* 이라는 공통 anti-pattern (#7-C) — "내가 *지금* 받아들이고 있는 결론을 누군가 push 안 했어도 받아들였을지" self-check.
