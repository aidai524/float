// 显示器亮度读写（macOS）。使用 DisplayServices 私有接口。
// 构建见 tools/build-brightness.sh（本机 CLT 的 MacOSX27 SDK 与 clang 不匹配，
// 需显式指定旧 SDK，例如 MacOSX15.4.sdk）。
//
// 用法：brightness            # 打印当前亮度 0..1
//       brightness 0.05       # 设置亮度
#include <stdio.h>
#include <stdlib.h>
#include <dlfcn.h>
#include <CoreGraphics/CoreGraphics.h>

typedef int (*GetFn)(CGDirectDisplayID, float *);
typedef int (*SetFn)(CGDirectDisplayID, float);

int main(int argc, char **argv) {
  void *h = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_NOW);
  if (!h) { fprintf(stderr, "dlopen failed: %s\n", dlerror()); return 2; }
  GetFn getB = (GetFn)dlsym(h, "DisplayServicesGetBrightness");
  SetFn setB = (SetFn)dlsym(h, "DisplayServicesSetBrightness");
  if (!getB || !setB) { fprintf(stderr, "dlsym failed\n"); return 2; }

  CGDirectDisplayID d = CGMainDisplayID();
  if (argc >= 2) {
    float v = (float)atof(argv[1]);
    if (v < 0) v = 0; if (v > 1) v = 1;
    int r = setB(d, v);
    if (r != 0) { fprintf(stderr, "set failed rc=%d\n", r); return 1; }
    printf("%.4f\n", v);
  } else {
    float cur = -1;
    int r = getB(d, &cur);
    if (r != 0) { fprintf(stderr, "get failed rc=%d\n", r); return 1; }
    printf("%.4f\n", cur);
  }
  return 0;
}
