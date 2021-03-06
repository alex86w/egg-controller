import 'reflect-metadata';
import * as co from 'co';
import { Context } from 'egg';
import { getGlobalType } from 'power-di/utils';
import { getInstance } from 'egg-aop';
import { getParameterNames, isGeneratorFunction } from './util';
import { RouteType, RouteMetadataType } from './type';
import { ParamInfoType, getMethodRules, getParamData } from './param';
import { paramValidateMiddleware } from './middleware/param';
import { getControllerMetadata } from './controller';

/** 路由注解 */
export function route<T = any>(url?: string | RegExp | RouteMetadataType<T>, data: RouteMetadataType<T> = {}): MethodDecorator {
  if (typeof url === 'string' || url instanceof RegExp) {
    data.url = url;
  } else if (url) {
    // url is metadata
    data = url;
  }

  return function (target: any, key: string) {
    const CtrlType = target.constructor;
    const typeGlobalName = getGlobalType(CtrlType);
    const routeFn: Function = target[key];

    const paramTypes = Reflect.getMetadata('design:paramtypes', target, key) || [];

    /** from @ali/ts-metadata */
    const validateMetaInfo: any[] = [
      ...(Reflect.getMetadata('custom:validateRule', target, key) || data.validateMetaInfo || [])
    ];

    const methodRules = getMethodRules(target, key);

    const typeInfo: RouteType = {
      onError: function (_ctx, err) {
        throw err;
      },
      ...data,
      typeGlobalName,
      typeClass: CtrlType,
      functionName: key,
      paramTypes: [],
      returnType: Reflect.getMetadata('design:returntype', target, key),
      middleware: (data.middleware || []),
      call: () => target[key],
    };

    /** complete params info */
    const paths = typeof typeInfo.url === 'string' && typeInfo.url.split('/');
    getParameterNames(routeFn).forEach((name, i) => {
      const config = methodRules.config[i] || {} as ParamInfoType;
      const validateTypeIndex = validateMetaInfo.findIndex(v => v.name === name);
      typeInfo.paramTypes.push({
        name,
        type: paramTypes[i] === undefined ? Object : paramTypes[i],
        paramName: config.paramName || name,
        getter: methodRules.param[i],
        source: config.source || (paths && paths.some(p => p === `:${config.paramName || name}`) ? 'Param' : 'Any'),
        hidden: config.hidden,
        validateType: validateTypeIndex >= 0 ?
          validateMetaInfo.splice(validateTypeIndex, 1)[0].rule : undefined,
      });
    });
    if (validateMetaInfo.length) {
      throw new Error(`[egg-controller] route: ${typeGlobalName}.${key} param validate defined error! no param use: ${JSON.stringify(validateMetaInfo)}`);
    }

    // add param validate middleware
    typeInfo.middleware.push(paramValidateMiddleware);

    let value: any = routeFn;
    value = async function (this: any, ctx: Context) {
      // 'this' maybe is Controller or Context, in Chair.
      ctx = (this.request && this.response ? this : this.ctx) || ctx;
      const ctrl = getInstance(CtrlType, ctx.app, ctx);
      const args = await getParamData(ctx, typeInfo);
      try {
        let ret;
        if (isGeneratorFunction(routeFn)) {
          ret = await co(ctrl[key](...args));
        } else {
          ret = await Promise.resolve(ctrl[key](...args));
        }
        if (ret instanceof Error) {
          if (ctx.app.env === 'local') {
            throw new Error('请用 throw Error 替代 return Error');
          } else {
            throw ret;
          }
        } else if (ret !== undefined) {
          ctx.body = ret;
        }

        const { ret404WhenNoChangeBody } = ctx.app.config.controller.compatible;
        if (!ret404WhenNoChangeBody && ctx.body === undefined && ctx.status === 404) {
          ctx.status = 204;
        }
        return ret;
      } catch (error) {
        typeInfo.onError(ctx, error);
      }
    };

    value.__name = key;
    typeInfo.call = () => value;
    getControllerMetadata(CtrlType).routes.push(typeInfo);
  };
}
