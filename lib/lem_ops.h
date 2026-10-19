#ifndef LEM_OPS_H
#define LEM_OPS_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
#define LEM_OPS_STATE_DIM   16
#define LEM_OPS_SCHEMA_DIM  128
#define LEM_OPS_SUCCESS      0
#define LEM_OPS_ERR_INVALID -1
#define LEM_OPS_ERR_ENERGY  1.0e9

typedef struct {
    uint8_t opaque_context[1152] __attribute__((aligned(8)));
} lemops_context_t;

int lemops_init(lemops_context_t* ctx, const double* schema_s128);
int lemops_evaluate(lemops_context_t* ctx, const double* state_z16, double* energy_out);
const char* lemops_get_version(void);
#ifdef __cplusplus
}
#endif
#endif
